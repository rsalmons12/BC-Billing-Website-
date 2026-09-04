import { redirect } from "next/navigation";
import { requireProfile, accessibleFacilities } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/page";
import Header from "@/components/Header";
import RecapActions from "@/components/overview/RecapActions";
import FacilityPicker from "@/components/overview/FacilityPicker";
import { money } from "@/lib/format";
import { periodOf } from "@/lib/import/parseTrackers";
import { arBalance, isExcludedMember, isStaleClaim, isDemoFacility } from "@/lib/claims";
import { statusPayerName } from "@/lib/payer";
import type { Claim, Payment, BilledClaim, Authorization, AuthIssue, Facility } from "@/lib/types";

export const dynamic = "force-dynamic";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const num = (v: any) => (typeof v === "number" ? v : Number(v) || 0);
const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const pct = (cur: number, prev: number) =>
  prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: { facility?: string };
}) {
  const { profile, email } = await requireProfile();
  if (profile.role === "pending") redirect("/pending");
  const isManagement = profile.role === "management";

  const supabase = createClient();
  const facilitiesAll = await accessibleFacilities();
  const facilities = facilitiesAll.filter(
    (f) => !isDemoFacility(f.name) && !isDemoFacility(f.short_name)
  );

  // Optional single-facility scope (management/staff can pick one).
  const picked =
    searchParams.facility && facilities.some((f) => f.id === searchParams.facility)
      ? searchParams.facility
      : "all";
  const scopedFacilities = picked === "all" ? facilities : facilities.filter((f) => f.id === picked);
  const facIds = new Set(scopedFacilities.map((f) => f.id));
  const inScope = <T extends { facility_id?: string | null }>(rows: T[]): T[] =>
    rows.filter((r) => r.facility_id != null && facIds.has(r.facility_id));

  const safeAll = <T,>(
    build: (f: number, t: number) => PromiseLike<{ data: T[] | null; error: unknown }>
  ) => selectAll<T>(build as never).catch(() => [] as T[]);

  const [claimsRaw, paymentsRaw, billedRaw, authsRaw, issuesRaw] = await Promise.all([
    safeAll<Claim>((f, t) =>
      supabase.from("claims").select("*").eq("present", true).range(f, t)
    ),
    safeAll<Payment>((f, t) => supabase.from("payments").select("*").range(f, t)),
    safeAll<BilledClaim>((f, t) => supabase.from("billed_claims").select("*").range(f, t)),
    safeAll<Authorization>((f, t) => supabase.from("authorizations").select("*").range(f, t)),
    safeAll<AuthIssue>((f, t) => supabase.from("auth_issues").select("*").range(f, t)),
  ]);

  const claims = inScope(claimsRaw).filter(
    (c) => !isExcludedMember(c.member_id) && !isStaleClaim(c.age_days)
  );
  const payments = inScope(paymentsRaw);
  const billed = inScope(billedRaw);
  const auths = inScope(authsRaw);
  const issues = inScope(issuesRaw);

  // ---- Month keys ----
  const now = new Date();
  const thisKey = ymOf(now);
  const lastDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastKey = ymOf(lastDate);
  const monthLabel = now.toLocaleString("en-US", { month: "short", year: "numeric" });
  const lastLabel = lastDate.toLocaleString("en-US", { month: "short", year: "numeric" });

  const bilMonth = (b: BilledClaim) => b.period || periodOf(b.entered_date ?? "");
  const payMonth = (p: Payment) =>
    periodOf(p.deposit_date ?? "", p.payment_entered ?? "", p.period ?? "");

  const billedThisRows = billed.filter((b) => bilMonth(b) === thisKey);
  const billedLastRows = billed.filter((b) => bilMonth(b) === lastKey);
  const totalBilled = billedThisRows.reduce((s, b) => s + num(b.total_amount), 0);
  const totalBilledLast = billedLastRows.reduce((s, b) => s + num(b.total_amount), 0);
  const totalCollected = payments
    .filter((p) => payMonth(p) === thisKey)
    .reduce((s, p) => s + num(p.paid_amount), 0);
  const totalCollectedLast = payments
    .filter((p) => payMonth(p) === lastKey)
    .reduce((s, p) => s + num(p.paid_amount), 0);
  const collectionRate =
    totalBilled > 0 ? totalCollected / totalBilled : totalCollected > 0 ? 1 : 0;
  const totalAR = claims.reduce((s, c) => s + arBalance(c.balance), 0);

  // ---- Authorizations (current auth per patient) ----
  const today0 = new Date();
  today0.setHours(0, 0, 0, 0);
  const pAuthDate = (v: unknown) => {
    const t = Date.parse(String(v ?? ""));
    if (isNaN(t)) return null;
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d;
  };
  const authRecency = (a: Authorization) => {
    const ds = [a.start_date, a.admit_date].map(pAuthDate).filter(Boolean) as Date[];
    if (ds.length) return Math.max(...ds.map((d) => d.getTime()));
    const c = Date.parse(a.created_at || "");
    return isNaN(c) ? 0 : c;
  };
  const authIsOut = (a: Authorization) => {
    if (a.discharged) return true;
    const dd = pAuthDate(a.discharge_date);
    return dd != null && dd.getTime() <= today0.getTime();
  };
  const currentAuth = new Map<string, Authorization>();
  for (const a of auths) {
    const key = `${(a.patient_name ?? "").trim().toLowerCase()}|${a.facility_id ?? ""}`;
    if (!key.replace("|", "").trim()) continue;
    const cur = currentAuth.get(key);
    if (!cur || authRecency(a) > authRecency(cur)) currentAuth.set(key, a);
  }
  const activeAuths = Array.from(currentAuth.values()).filter((a) => !authIsOut(a));
  const activeAuthCount = activeAuths.length;
  const authDue = activeAuths.filter((a) => {
    const d = pAuthDate(a.next_review_date);
    return d != null && d.getTime() <= today0.getTime();
  }).length;
  const openAuthIssues = issues.filter((i) => !/complete/i.test(i.status ?? "")).length;

  // ---- Snapshot metrics ----
  const agedAR = claims
    .filter((c) => (c.age_days ?? 0) >= 60)
    .reduce((s, c) => s + arBalance(c.balance), 0);
  const payerUnknownAR = claims
    .filter((c) => !statusPayerName(c.claim_status))
    .reduce((s, c) => s + arBalance(c.balance), 0);

  // Payer concentration of AR (mix health).
  const arByPayer = new Map<string, number>();
  for (const c of claims) {
    const p = statusPayerName(c.claim_status) || "Unknown";
    arByPayer.set(p, (arByPayer.get(p) ?? 0) + arBalance(c.balance));
  }
  const topShare =
    totalAR > 0 ? Math.max(0, ...Array.from(arByPayer.values())) / totalAR : 0;
  const mixHealth = topShare <= 0.45 ? "Diversified" : topShare <= 0.65 ? "Balanced" : "Concentrated";

  // ---- Level-of-care sessions this vs last month (from billed loc_units) ----
  const LOC_ORDER = ["PHP", "IOP", "OP", "SUD"];
  const locAgg = (rows: BilledClaim[]) => {
    const sess: Record<string, number> = {};
    const clients: Record<string, Set<string>> = {};
    for (const b of rows) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lu = (b as any).loc_units as Record<string, number> | null;
      if (!lu) continue;
      const name = String(b.patient_name ?? "").trim().toLowerCase();
      for (const [loc, u] of Object.entries(lu)) {
        sess[loc] = (sess[loc] ?? 0) + (Number(u) || 0);
        (clients[loc] ??= new Set()).add(name);
      }
    }
    return { sess, clients };
  };
  const curLoc = locAgg(billedThisRows);
  const priorLoc = locAgg(billedLastRows);
  const locKeys = [
    ...LOC_ORDER.filter((k) => k in curLoc.sess || k in priorLoc.sess),
    ...Object.keys({ ...curLoc.sess, ...priorLoc.sess }).filter((k) => !LOC_ORDER.includes(k)),
  ];
  const locRows = locKeys.map((k) => ({
    loc: k,
    cur: curLoc.sess[k] ?? 0,
    prior: priorLoc.sess[k] ?? 0,
    clientsCur: curLoc.clients[k]?.size ?? 0,
    clientsPrior: priorLoc.clients[k]?.size ?? 0,
  }));
  const locTotal = {
    cur: locRows.reduce((s, r) => s + r.cur, 0),
    prior: locRows.reduce((s, r) => s + r.prior, 0),
    clientsCur: locRows.reduce((s, r) => s + r.clientsCur, 0),
    clientsPrior: locRows.reduce((s, r) => s + r.clientsPrior, 0),
  };

  const billedPct = pct(totalBilled, totalBilledLast);
  const doingWell = collectionRate >= 0.9 && openAuthIssues === 0;
  const heroThird = collectionRate >= 0.9 ? "Ahead of the Curve." : "On the Right Track.";

  const pickerFacilities = facilities.map((f) => ({ id: f.id, label: f.short_name || f.name }));

  return (
    <>
      <Header profile={profile} email={email} subtitle="Network Overview" />
      <main className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl space-y-5 p-5">
          {/* Banner (management only) */}
          {isManagement && (
            <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-surface-ink">
                <span className="text-brand-green">✔</span>
                {doingWell
                  ? "Your facilities are performing great. Keep up the excellent work!"
                  : "Here's where your facilities stand this month."}
              </div>
              <RecapActions />
            </div>
          )}

          {/* Top KPIs */}
          <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Total Billed" value={money(totalBilled)} sub={monthLabel} icon="$" badge="blue" />
            <Kpi
              label="Total Collected"
              value={money(totalCollected)}
              sub={monthLabel}
              icon="📈"
              badge="green"
              green
            />
            <Kpi
              label="Collection Rate"
              value={`${(collectionRate * 100).toFixed(1)}%`}
              sub={monthLabel}
              icon="🛡"
              badge="green"
            />
            <Kpi
              label="Total Outstanding"
              value={money(totalAR)}
              sub="Across facilities"
              icon="🧾"
              badge="blue"
            />
            <Kpi
              label="Active Authorizations"
              value={activeAuthCount.toLocaleString()}
              sub={authDue > 0 ? `${authDue} due for review` : "Up to date"}
              icon="🛡"
              badge="blue"
            />
            <Kpi
              label="Open Auth Issues"
              value={openAuthIssues.toLocaleString()}
              sub={openAuthIssues === 0 ? "All caught up" : "Need attention"}
              icon={openAuthIssues === 0 ? "✓" : "!"}
              badge={openAuthIssues === 0 ? "green" : "red"}
            />
          </section>

          {/* Performance Snapshot */}
          <section className="card p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-display text-lg font-bold">Performance Snapshot</div>
                <div className="text-xs text-surface-muted">
                  {monthLabel} vs {lastLabel}
                </div>
              </div>
              <FacilityPicker facilities={pickerFacilities} value={picked} />
            </div>

            <div className="grid gap-5 lg:grid-cols-[1fr_2fr]">
              {/* Hero */}
              <div className="flex flex-col justify-center">
                <div className="font-display text-2xl font-extrabold leading-tight text-surface-ink">
                  On Track.
                  <br />
                  On Point.
                  <br />
                  <span className="text-brand-blue">{heroThird}</span>
                </div>
                <p className="mt-3 text-sm text-surface-muted">
                  {billedPct != null && billedPct >= 0
                    ? "Billing is up and collections are landing — the team keeps your revenue moving forward."
                    : "Steady performance across the board — the team keeps your revenue moving forward."}
                </p>
              </div>

              {/* Snapshot cards */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Snap
                  label="Billed (Pipeline)"
                  value={money(totalBilled)}
                  delta={billedPct}
                  deltaLabel="vs last month"
                />
                <Snap
                  label="Collections Aging (60+)"
                  value={money(agedAR)}
                  note={totalAR > 0 ? `${Math.round((agedAR / totalAR) * 100)}% of AR` : "—"}
                />
                <SnapLabel label="Payer Mix Health" value={mixHealth} note="AR spread across payers" />
                <Snap
                  label="Payer Unknown"
                  value={money(payerUnknownAR)}
                  note={totalAR > 0 ? `${Math.round((payerUnknownAR / totalAR) * 100)}% of AR` : "—"}
                />
                <Snap
                  label="Authorization Pipeline"
                  value={authDue.toLocaleString()}
                  note="due for review"
                />
                <SnapLabel
                  label="Level-of-Care Mix"
                  value={locTotal.cur > 0 ? "Optimal" : "—"}
                  note="Higher acuity. Higher value."
                />
              </div>
            </div>

            {/* Services billed by level of care */}
            {locRows.length > 0 && (
              <div className="mt-6">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-surface-muted">
                  Services billed by level of care · {monthLabel} vs {lastLabel}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-surface-muted">
                        <th className="th">Level of Care</th>
                        <th className="th text-right">Services · {monthLabel}</th>
                        <th className="th text-right">Services · {lastLabel}</th>
                        <th className="th text-center">Trend</th>
                        <th className="th text-right">Clients (this / last)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {locRows.map((r) => (
                        <tr key={r.loc} className="border-t border-surface-border">
                          <td className="td font-semibold">{r.loc}</td>
                          <td className="td text-right font-mono">{r.cur}</td>
                          <td className="td text-right font-mono text-surface-muted">{r.prior}</td>
                          <td className="td text-center">
                            {r.cur > r.prior ? (
                              <span className="text-brand-green">▲</span>
                            ) : r.cur < r.prior ? (
                              <span className="text-risk">▼</span>
                            ) : (
                              <span className="text-surface-muted">—</span>
                            )}
                          </td>
                          <td className="td text-right font-mono">
                            {r.clientsCur} / {r.clientsPrior}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-surface-border font-semibold">
                        <td className="td">TOTAL</td>
                        <td className="td text-right font-mono">{locTotal.cur}</td>
                        <td className="td text-right font-mono text-surface-muted">{locTotal.prior}</td>
                        <td className="td text-center">
                          {locTotal.cur >= locTotal.prior ? (
                            <span className="text-brand-green">▲</span>
                          ) : (
                            <span className="text-risk">▼</span>
                          )}
                        </td>
                        <td className="td text-right font-mono">
                          {locTotal.clientsCur} / {locTotal.clientsPrior}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* Brand footer */}
          <section className="rounded-xl bg-command p-5 text-command-text">
            <div className="font-display text-lg font-extrabold">
              SUPERIOR INSIGHTS. <span className="text-brand-green">STRONGER RESULTS.</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4 text-xs md:grid-cols-4">
              <Value title="Real-Time Visibility" body="Live data. Clear trends. Smarter decisions." />
              <Value title="Revenue Focused" body="Maximizing collections. Minimizing leakage." />
              <Value title="Dedicated" body="Your team, on your revenue, every day." />
              <Value title="Better Outcomes" body="Healthier revenue cycle. Stronger bottom line." />
            </div>
            <div className="mt-3 text-sm italic text-command-muted">
              We don&apos;t just manage revenue. We maximize it.
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

function Kpi({
  label,
  value,
  sub,
  icon,
  badge,
  green,
}: {
  label: string;
  value: string;
  sub: string;
  icon: string;
  badge: "blue" | "green" | "red";
  green?: boolean;
}) {
  const badgeCls = {
    blue: "bg-brand-blue/10 text-brand-blue",
    green: "bg-brand-green/10 text-brand-green",
    red: "bg-risk/10 text-risk",
  }[badge];
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-surface-muted">
            {label}
          </div>
          <div
            className={`mt-1 font-display text-xl font-bold ${green ? "text-brand-green" : "text-surface-ink"}`}
          >
            {value}
          </div>
          <div className="mt-0.5 text-[11px] text-surface-muted">{sub}</div>
        </div>
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base ${badgeCls}`}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

function Snap({
  label,
  value,
  delta,
  deltaLabel,
  note,
}: {
  label: string;
  value: string;
  delta?: number | null;
  deltaLabel?: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-surface-border p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-surface-muted">
        {label}
      </div>
      <div className="mt-1 font-display text-lg font-bold text-surface-ink">{value}</div>
      {delta != null && (
        <div className={`text-[11px] ${delta >= 0 ? "text-brand-green" : "text-risk"}`}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}% {deltaLabel}
        </div>
      )}
      {note && <div className="text-[11px] text-surface-muted">{note}</div>}
    </div>
  );
}

function SnapLabel({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-surface-border p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-surface-muted">
        {label}
      </div>
      <div className="mt-1 font-display text-lg font-bold text-brand-green">{value}</div>
      <div className="text-[11px] text-surface-muted">{note}</div>
    </div>
  );
}

function Value({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="font-bold text-command-text">{title}</div>
      <div className="text-command-muted">{body}</div>
    </div>
  );
}
