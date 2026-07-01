import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/page";
import Header from "@/components/Header";
import { money } from "@/lib/format";
import { isExcludedMember } from "@/lib/claims";
import type {
  Claim,
  Payment,
  Negotiation,
  BilledClaim,
  Facility,
} from "@/lib/types";

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
  searchParams: { facility?: string };
}) {
  const { profile, email } = await requireProfile();
  if (profile.role !== "facility") redirect("/");

  const supabase = createClient();
  const now = new Date();
  const monthLabel = now.toLocaleString("en-US", { month: "long", year: "numeric" });

  // RLS returns every facility this login may see (primary + any extras granted
  // via assignments). Each data query below is likewise scoped to those.
  const [{ data: facList }, allClaims, allPayments, allNegotiations, allBilled] =
    await Promise.all([
      supabase.from("facilities").select("*").order("name", { ascending: true }),
      selectAll<Claim>((f, t) =>
        supabase.from("claims").select("*").eq("present", true).range(f, t)
      ),
      selectAll<Payment>((f, t) => supabase.from("payments").select("*").range(f, t)),
      selectAll<Negotiation>((f, t) =>
        supabase.from("negotiations").select("*").range(f, t)
      ),
      selectAll<BilledClaim>((f, t) =>
        supabase.from("billed_claims").select("*").range(f, t)
      ),
    ]);

  const facilities = (facList as Facility[]) ?? [];
  const multi = facilities.length > 1;

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
  const claims = scoped(allClaims).filter((c) => !isExcludedMember(c.member_id));
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

  // ---- Payments collected this month + per payer ---------------------------
  const monthPayments = payments.filter(
    (p) => isThisMonth(p.deposit_date, now) || isThisMonth(p.payment_entered, now)
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

  // ---- Billed this month (from the CollaborateMD billed report) ------------
  const billedThisMonth = billed
    .filter((b) => isThisMonth(b.entered_date, now))
    .reduce((s, b) => s + (b.total_amount ?? 0), 0);

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

          {/* AR by payer */}
          <Breakdown
            title="Outstanding AR by payer"
            total={totalAR}
            rows={arRows}
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
}: {
  title: string;
  total: number;
  rows: [string, number][];
  empty: string;
  accent: "gold" | "recovered";
}) {
  const bar = accent === "gold" ? "bg-gold" : "bg-recovered";
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
          {rows.map(([payer, amt]) => (
            <div key={payer} className="flex items-center gap-3">
              <div className="w-40 shrink-0 truncate text-sm font-medium" title={payer}>
                {payer}
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
          ))}
        </div>
      )}
    </section>
  );
}
