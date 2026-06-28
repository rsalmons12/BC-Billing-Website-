import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Header from "@/components/Header";
import { money } from "@/lib/format";
import {
  RISK_AGE_THRESHOLD,
  type Claim,
  type ClaimWork,
  type AuthIssue,
  type Facility,
} from "@/lib/types";

export default async function FacilityDashboard() {
  const { profile, email } = await requireProfile();

  if (profile.role !== "facility") {
    redirect("/");
  }

  const supabase = createClient();

  // RLS restricts all of these to the user's single facility automatically.
  const [{ data: facData }, { data: claimsData }, { data: issuesData }] =
    await Promise.all([
      supabase.from("facilities").select("*").limit(1).maybeSingle(),
      supabase
        .from("claims")
        .select("*")
        .eq("present", true)
        .order("age_days", { ascending: false }),
      supabase
        .from("auth_issues")
        .select("*")
        .order("created_at", { ascending: false }),
    ]);

  const facility = facData as Facility | null;
  const claims = (claimsData as Claim[]) ?? [];
  const issues = (issuesData as AuthIssue[]) ?? [];

  const ids = claims.map((c) => c.claim_id);
  let workMap: Record<string, ClaimWork> = {};
  if (ids.length) {
    const { data: work } = await supabase
      .from("claim_work")
      .select("*")
      .in("claim_id", ids);
    for (const w of (work as ClaimWork[]) ?? []) workMap[w.claim_id] = w;
  }

  const charged = claims.reduce((s, c) => s + (c.charge_amount ?? 0), 0);
  const balance = claims.reduce((s, c) => s + (c.balance ?? 0), 0);
  const recovered = charged - balance;
  const recoveredPct = charged > 0 ? Math.round((recovered / charged) * 100) : 0;

  const highRisk = claims.filter((c) => (c.age_days ?? 0) > RISK_AGE_THRESHOLD);
  const highRiskBalance = highRisk.reduce((s, c) => s + (c.balance ?? 0), 0);
  const openIssues = issues.filter((i) => i.status !== "Completed");

  return (
    <>
      <Header
        profile={profile}
        email={email}
        subtitle={facility?.short_name || facility?.name || "Facility Dashboard"}
      />
      <main className="min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="rounded-lg bg-secured/8 px-4 py-2 text-xs font-medium text-secured">
            Read-only view · your facility&apos;s live billing status
          </div>

          {/* Ledger */}
          <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Charged" value={money(charged)} />
            <Stat
              label="Recovered"
              value={money(recovered)}
              accent="recovered"
              sub={`${recoveredPct}% of charged`}
            />
            <Stat label="Outstanding" value={money(balance)} accent="gold" />
            <Stat
              label="High-Risk 65+"
              value={String(highRisk.length)}
              accent="risk"
              sub={money(highRiskBalance) + " at risk"}
            />
          </section>

          {/* Recovery bar */}
          <section className="card p-5">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-semibold">Recovery progress</span>
              <span className="font-mono text-surface-muted">
                {money(recovered)} / {money(charged)}
              </span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-surface">
              <div
                className="h-full rounded-full bg-recovered"
                style={{ width: `${Math.min(recoveredPct, 100)}%` }}
              />
            </div>
          </section>

          {/* Auth issues */}
          <section className="card overflow-hidden">
            <div className="border-b border-surface-border px-5 py-3 font-semibold">
              Authorization issues{" "}
              <span className="text-sm font-normal text-surface-muted">
                ({openIssues.length} open)
              </span>
            </div>
            {issues.length === 0 ? (
              <p className="px-5 py-6 text-sm text-surface-muted">
                No authorization issues on file.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th">Patient</th>
                    <th className="th">Payer</th>
                    <th className="th text-right">Amount</th>
                    <th className="th">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.slice(0, 25).map((i, idx) => (
                    <tr
                      key={i.id}
                      className={idx % 2 ? "bg-surface/40" : ""}
                    >
                      <td className="td">{i.patient_name || "—"}</td>
                      <td className="td text-xs">{i.payer || "—"}</td>
                      <td className="td text-right font-mono">
                        {money(i.charge_amount)}
                      </td>
                      <td className="td">
                        <StatusPill status={i.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Open claims */}
          <section className="card overflow-hidden">
            <div className="border-b border-surface-border px-5 py-3 font-semibold">
              Open claims{" "}
              <span className="text-sm font-normal text-surface-muted">
                ({claims.length})
              </span>
            </div>
            <div className="scroll-x max-h-[28rem] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-card">
                  <tr>
                    <th className="th">Patient</th>
                    <th className="th">Age</th>
                    <th className="th">DOS</th>
                    <th className="th text-right">Balance</th>
                    <th className="th">Status</th>
                    <th className="th">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {claims.map((c, idx) => {
                    const w = workMap[c.claim_id];
                    const risk = (c.age_days ?? 0) > RISK_AGE_THRESHOLD;
                    return (
                      <tr
                        key={c.claim_id}
                        className={idx % 2 ? "bg-surface/40" : ""}
                      >
                        <td className="td font-medium">
                          {c.patient_name || "—"}
                        </td>
                        <td className="td">
                          <span
                            className={`badge font-mono ${
                              risk
                                ? "bg-risk/12 text-risk"
                                : "bg-surface text-surface-muted"
                            }`}
                          >
                            {c.age_days ?? 0}d
                          </span>
                        </td>
                        <td className="td text-xs text-surface-muted">
                          {c.dos_from || "—"}
                        </td>
                        <td className="td text-right font-mono">
                          {money(c.balance)}
                        </td>
                        <td className="td text-xs">{c.claim_status || "—"}</td>
                        <td className="td max-w-[24rem] truncate text-xs text-surface-muted">
                          {w?.notes || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "recovered" | "risk" | "gold";
}) {
  const color =
    accent === "recovered"
      ? "text-recovered"
      : accent === "risk"
        ? "text-risk"
        : accent === "gold"
          ? "text-gold"
          : "text-surface-ink";
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className={`font-display text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-surface-muted">{sub}</div>}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "Completed"
      ? "bg-recovered/12 text-recovered"
      : status === "Working"
        ? "bg-gold/15 text-gold"
        : "bg-surface text-surface-muted";
  return <span className={`badge ${cls}`}>{status}</span>;
}
