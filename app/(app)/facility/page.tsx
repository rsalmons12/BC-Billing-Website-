import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/page";
import Header from "@/components/Header";
import MoneyOutlookPanel from "@/components/overview/MoneyOutlookPanel";
import { money } from "@/lib/format";
import { isExcludedMember, isRiskPayer } from "@/lib/claims";
import { computeOutlooks } from "@/lib/report/moneyOutlook";
import type {
  Claim,
  Payment,
  Negotiation,
  BilledClaim,
  Authorization,
  Census,
  Facility,
} from "@/lib/types";

type RepriceRow = {
  facility_id: string | null;
  total_amount: number | null;
  amount_paid: number | null;
  claim_status: string | null;
};

// Share of outstanding AR we expect to collect (facility projection rule).
const EXPECTED_RATE = 0.33;
// Negotiated dollars are expected ~14 days after the approval/signed date.
const NEG_PAY_LAG_DAYS = 14;

// Pull the payer out of a claim status like "Claim at BCBS" / "Denied at
// Aetna". Everything after the last " at " is the payer; otherwise "Other".
function payerFromStatus(status: unknown): string {
  const t = String(status ?? "").trim();
  if (!t) return "Unassigned";
  const m = t.match(/\bat\s+(.+)$/i);
  if (!m) return "Other";
  const p = m[1].split(/\s{2,}|[|,;]/)[0].trim();
  return p ? p.toUpperCase() : "Other";
}

function parseDate(v: unknown): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const t = Date.parse(s);
  return isNaN(t) ? null : new Date(t);
}

function isThisMonth(v: unknown, now: Date): boolean {
  const d = parseDate(v);
  return (
    !!d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  );
}

export default async function FacilityDashboard({
  searchParams,
}: {
  searchParams: { facility?: string; month?: string };
}) {
  const { profile, email } = await requireProfile();
  if (profile.role !== "facility") redirect("/");

  const supabase = createClient();
  const now = new Date();
  // Which month the dashboard's "this month" figures show. Defaults to the
  // current month; ?month=YYYY-MM lets a facility look back at prior months.
  const monthParam = /^\d{4}-\d{2}$/.test(searchParams.month ?? "")
    ? (searchParams.month as string)
    : "";
  const viewMonth = monthParam
    ? new Date(Number(monthParam.slice(0, 4)), Number(monthParam.slice(5, 7)) - 1, 1)
    : now;
  const monthLabel = viewMonth.toLocaleString("en-US", { month: "long", year: "numeric" });
  const viewMonthKey = `${viewMonth.getFullYear()}-${String(viewMonth.getMonth() + 1).padStart(2, "0")}`;

  // The exact set of facilities THIS login may see: its primary facility plus
  // any explicitly granted via assignments. Computed in-app so the dashboard
  // never depends on the facilities table's RLS to scope what's shown.
  const { data: asgData } = await supabase
    .from("assignments")
    .select("facility_id")
    .eq("profile_id", profile.id);
  const accessibleIds = new Set<string>(
    [
      profile.facility_id,
      ...((asgData ?? []).map((a) => (a as { facility_id: string }).facility_id)),
    ].filter(Boolean) as string[]
  );

  // Resilient fetch: one table erroring (RLS/permission/missing) must NOT crash
  // the whole dashboard — that section just shows nothing.
  const safeAll = <T,>(
    build: (f: number, t: number) => PromiseLike<{ data: T[] | null; error: unknown }>
  ) => selectAll<T>(build as never).catch(() => [] as T[]);

  const [
    { data: facList },
    allClaimsRaw,
    allPaymentsRaw,
    allNegRaw,
    allBilledRaw,
    allAuthsRaw,
    allCensusRaw,
    allRepricingRaw,
  ] = await Promise.all([
    supabase.from("facilities").select("*").order("name", { ascending: true }),
    safeAll<Claim>((f, t) =>
      supabase.from("claims").select("*").eq("present", true).range(f, t)
    ),
    safeAll<Payment>((f, t) => supabase.from("payments").select("*").range(f, t)),
    safeAll<Negotiation>((f, t) => supabase.from("negotiations").select("*").range(f, t)),
    safeAll<BilledClaim>((f, t) => supabase.from("billed_claims").select("*").range(f, t)),
    safeAll<Authorization>((f, t) => supabase.from("authorizations").select("*").range(f, t)),
    safeAll<Census>((f, t) => supabase.from("census").select("*").range(f, t)),
    safeAll<RepriceRow>((f, t) => supabase.from("repricing").select("*").range(f, t)),
  ]);

  // Hard scope everything to this login's facilities.
  const inScope = <T extends { facility_id?: string | null }>(rows: T[]): T[] =>
    rows.filter((r) => r.facility_id != null && accessibleIds.has(r.facility_id));

  const facilities = ((facList as Facility[]) ?? []).filter((f) =>
    accessibleIds.has(f.id)
  );
  const allClaims = inScope(allClaimsRaw);
  const allPayments = inScope(allPaymentsRaw);
  const allNegotiations = inScope(allNegRaw);
  const allBilled = inScope(allBilledRaw);
  const allAuths = inScope(allAuthsRaw);
  const allCensus = inScope(allCensusRaw);
  const allRepricing = inScope(allRepricingRaw);
  const multi = facilities.length > 1;

  // Money Outlook — month-over-month forecast with the reasons behind it, over
  // just this login's facilities (VMAH plans excluded from the aging signal).
  const outlooks = computeOutlooks({
    facilities: facilities.map((f) => ({ id: f.id, name: f.name, short_name: f.short_name })),
    payments: allPayments,
    billed: allBilled,
    claims: allClaims.filter((c) => !isExcludedMember(c.member_id)),
    auths: allAuths,
    census: allCensus,
    repricing: allRepricing,
  });

  // Which facility is being viewed: a specific one, or "all" (combined).
  const selectedId =
    searchParams.facility && facilities.some((f) => f.id === searchParams.facility)
      ? searchParams.facility
      : "all";
  const facility =
    selectedId === "all" ? null : facilities.find((f) => f.id === selectedId) ?? null;

  const scoped = <T extends { facility_id?: string | null }>(rows: T[]): T[] =>
    selectedId === "all" ? rows : rows.filter((r) => r.facility_id === selectedId);

  // Excluded plans (e.g. VMAH member ids) are removed from AR entirely.
  const inView = scoped(allClaims);
  const claims = inView.filter((c) => !isExcludedMember(c.member_id));
  // How much VMAH we pulled out — shown so this is verifiable at a glance.
  const excludedClaims = inView.filter((c) => isExcludedMember(c.member_id));
  const excludedAR = excludedClaims.reduce((s, c) => s + (c.balance ?? 0), 0);
  const payments = scoped(allPayments);
  const negotiations = scoped(allNegotiations);
  const billed = scoped(allBilled);

  const viewLabel = facility
    ? facility.short_name || facility.name
    : multi
      ? "All facilities (combined)"
      : facilities[0]?.short_name || facilities[0]?.name || "Facility Dashboard";

  // ---- AR (Outstanding Collections) + breakdown by payer (from status) -----
  const totalAR = claims.reduce((s, c) => s + (c.balance ?? 0), 0);
  const expectedRevenue = totalAR * EXPECTED_RATE;

  const arByPayer = new Map<string, number>();
  for (const c of claims) {
    const bal = c.balance ?? 0;
    if (bal <= 0) continue;
    const p = payerFromStatus(c.claim_status);
    arByPayer.set(p, (arByPayer.get(p) ?? 0) + bal);
  }
  const arRows = Array.from(arByPayer.entries()).sort((a, b) => b[1] - a[1]);

  // AR at risk of non-reimbursement (marketplace/exchange payers). Matched on
  // the claim status so it catches "Denied at Highmark", "at Independence", etc.
  const riskAR = claims.reduce(
    (s, c) => s + (isRiskPayer(c.claim_status) ? c.balance ?? 0 : 0),
    0
  );

  // ---- Payments collected in the viewed month + per payer ------------------
  const monthPayments = payments.filter(
    (p) => isThisMonth(p.deposit_date, viewMonth) || isThisMonth(p.payment_entered, viewMonth)
  );
  const collectedThisMonth = monthPayments.reduce(
    (s, p) => s + (p.paid_amount ?? 0),
    0
  );
  const payByPayer = new Map<string, number>();
  for (const p of monthPayments) {
    const src = (p.payment_source || "Other").toUpperCase();
    payByPayer.set(src, (payByPayer.get(src) ?? 0) + (p.paid_amount ?? 0));
  }
  const payRows = Array.from(payByPayer.entries())
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  // ---- Billed in the viewed month (from the CollaborateMD billed report) ---
  // Prefer the report's month tag; fall back to the entered date for old rows.
  const billedThisMonth = billed
    .filter((b) =>
      b.period ? b.period === viewMonthKey : isThisMonth(b.entered_date, viewMonth)
    )
    .reduce((s, b) => s + (b.total_amount ?? 0), 0);

  // Months available to look back at (from payment + billed dates), newest
  // first, for the month picker.
  const monthSet = new Set<string>();
  const addMonth = (v: unknown) => {
    const d = parseDate(v);
    if (d) monthSet.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  for (const p of allPayments) {
    addMonth(p.deposit_date);
    addMonth(p.payment_entered);
  }
  for (const b of allBilled) {
    if (b.period) monthSet.add(b.period);
    else addMonth(b.entered_date);
  }
  monthSet.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const availableMonths = Array.from(monthSet).sort().reverse().slice(0, 12);
  const curMonthKey = monthParam || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthShort = (ym: string) => {
    const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1);
    return d.toLocaleString("en-US", { month: "short", year: "numeric" });
  };
  const withParams = (m: string) => {
    const p = new URLSearchParams();
    if (searchParams.facility) p.set("facility", searchParams.facility);
    p.set("month", m);
    return `/facility?${p.toString()}`;
  };

  // ---- Negotiations: expected revenue, paid ~14 days after approval --------
  const approvedNegs = negotiations.filter((n) => /approv|signed/i.test(n.status || ""));
  const negExpected = approvedNegs.reduce(
    (s, n) => s + (n.negotiated_amount ?? n.approved_rate ?? 0),
    0
  );
  // How much is expected to land within the next 14 days (signed + 14 days).
  let negDueSoon = 0;
  const soon = new Date(now.getTime() + NEG_PAY_LAG_DAYS * 86400000);
  for (const n of approvedNegs) {
    const signed = parseDate(n.date_signed);
    if (!signed) continue;
    const payBy = new Date(signed.getTime() + NEG_PAY_LAG_DAYS * 86400000);
    if (payBy <= soon) negDueSoon += n.negotiated_amount ?? n.approved_rate ?? 0;
  }

  return (
    <>
      <Header profile={profile} email={email} subtitle={viewLabel} />
      <main className="min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="rounded-lg bg-secured/8 px-4 py-2 text-xs font-medium text-secured">
            Read-only overview · {viewLabel}
          </div>

          {excludedClaims.length > 0 && (
            <div className="rounded-lg bg-surface-card px-4 py-2 text-xs text-surface-muted">
              Excluded from AR (VMAH plans):{" "}
              <b className="text-surface-ink">{money(excludedAR)}</b> across{" "}
              {excludedClaims.length} claim{excludedClaims.length === 1 ? "" : "s"}.
            </div>
          )}

          {multi && (
            <div className="flex flex-wrap gap-2">
              <FacilityChip href="/facility" label="All (combined)" active={selectedId === "all"} />
              {facilities.map((f) => (
                <FacilityChip
                  key={f.id}
                  href={`/facility?facility=${f.id}`}
                  label={f.short_name || f.name}
                  active={selectedId === f.id}
                />
              ))}
            </div>
          )}

          {/* Month picker — Collected & Billed reflect the chosen month */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-surface-muted">
              Month:
            </span>
            {availableMonths.map((m) => (
              <FacilityChip
                key={m}
                href={withParams(m)}
                label={monthShort(m)}
                active={curMonthKey === m}
              />
            ))}
          </div>

          {/* Headline numbers */}
          <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <BigStat label="Total AR (Outstanding)" value={money(totalAR)} accent="gold" />
            <BigStat
              label="Expected Revenue"
              value={money(expectedRevenue)}
              accent="secured"
              sub={`${Math.round(EXPECTED_RATE * 100)}% of AR`}
            />
            <BigStat
              label={`Collected · ${monthLabel}`}
              value={money(collectedThisMonth)}
              accent="recovered"
            />
            <BigStat label={`Billed · ${monthLabel}`} value={money(billedThisMonth)} />
          </section>

          {/* Money Outlook — why revenue is improving or declining */}
          <MoneyOutlookPanel outlooks={outlooks} />

          {/* Non-reimbursement risk (marketplace / exchange payers) */}
          {riskAR > 0 && (
            <section className="card border border-risk/40 bg-risk/5 p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-semibold text-risk">
                    ⚠ Risk of non-reimbursement
                  </div>
                  <div className="mt-0.5 text-xs text-surface-muted">
                    Marketplace / exchange plans — Highmark, Capital Blue Cross,
                    Independence Blue Cross. Prioritize before these age out.
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-display text-2xl font-bold text-risk">
                    {money(riskAR)}
                  </div>
                  <div className="text-xs text-surface-muted">
                    {totalAR > 0 ? Math.round((riskAR / totalAR) * 100) : 0}% of AR
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* AR by payer */}
          <Breakdown
            title="Outstanding AR by payer"
            total={totalAR}
            rows={arRows}
            flagRisk
            empty="No outstanding balance on file."
            accent="gold"
          />

          {/* Payments this month by payer */}
          <Breakdown
            title={`Payments collected · ${monthLabel} — by payer`}
            total={collectedThisMonth}
            rows={payRows}
            empty={`No payments recorded yet for ${monthLabel}.`}
            accent="recovered"
          />

          {/* Negotiations */}
          <section className="card p-5">
            <div className="mb-3 font-semibold">Negotiations — expected revenue</div>
            {approvedNegs.length === 0 ? (
              <p className="text-sm text-surface-muted">
                No approved negotiations on file.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                <BigStat label="Approved / signed" value={String(approvedNegs.length)} />
                <BigStat
                  label="Expected revenue"
                  value={money(negExpected)}
                  accent="secured"
                />
                <BigStat
                  label="Landing within 14 days"
                  value={money(negDueSoon)}
                  accent="recovered"
                  sub={`paid ~${NEG_PAY_LAG_DAYS} days after approval`}
                />
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}

function FacilityChip({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`badge border transition ${
        active
          ? "border-command bg-command text-command-text"
          : "border-surface-border bg-surface text-surface-muted hover:border-surface-muted"
      }`}
    >
      {label}
    </Link>
  );
}

function BigStat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "recovered" | "gold" | "secured" | "risk";
}) {
  const color =
    accent === "recovered"
      ? "text-recovered"
      : accent === "gold"
        ? "text-gold"
        : accent === "secured"
          ? "text-secured"
          : accent === "risk"
            ? "text-risk"
            : "text-surface-ink";
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className={`font-display text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-surface-muted">{sub}</div>}
    </div>
  );
}

// A titled total with a per-payer bar breakdown (biggest first).
function Breakdown({
  title,
  total,
  rows,
  empty,
  accent,
  flagRisk = false,
}: {
  title: string;
  total: number;
  rows: [string, number][];
  empty: string;
  accent: "gold" | "recovered";
  flagRisk?: boolean;
}) {
  const max = rows.length ? rows[0][1] : 0;
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-semibold">{title}</span>
        <span className="font-mono text-sm text-surface-muted">{money(total)}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-surface-muted">{empty}</p>
      ) : (
        <div className="space-y-2">
          {rows.map(([payer, amt]) => {
            const risk = flagRisk && isRiskPayer(payer);
            const bar = risk
              ? "bg-risk"
              : accent === "gold"
                ? "bg-gold"
                : "bg-recovered";
            return (
              <div key={payer} className="flex items-center gap-3">
                <div
                  className={`flex w-44 shrink-0 items-center gap-1 truncate text-sm font-medium ${
                    risk ? "text-risk" : ""
                  }`}
                  title={risk ? `${payer} — non-reimbursement risk` : payer}
                >
                  <span className="truncate">{payer}</span>
                  {risk && <span title="Marketplace / exchange — non-reimbursement risk">⚠</span>}
                </div>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface">
                  <div
                    className={`h-full rounded-full ${bar}`}
                    style={{ width: `${max > 0 ? Math.max(3, (amt / max) * 100) : 0}%` }}
                  />
                </div>
                <div className="w-28 shrink-0 text-right font-mono text-sm">{money(amt)}</div>
                <div className="w-12 shrink-0 text-right text-xs text-surface-muted">
                  {total > 0 ? Math.round((amt / total) * 100) : 0}%
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
