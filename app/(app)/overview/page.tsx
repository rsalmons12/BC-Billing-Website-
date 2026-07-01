import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/page";
import Header from "@/components/Header";
import ExportButton, { type ExportRow } from "@/components/overview/ExportButton";
import { money } from "@/lib/format";
import { isExcludedMember } from "@/lib/claims";
import {
  RISK_AGE_THRESHOLD,
  type Claim,
  type AuthIssue,
  type Facility,
} from "@/lib/types";

export default async function OverviewPage() {
  const { profile, email } = await requireProfile();
  if (profile.role !== "management") redirect("/");

  const supabase = createClient();
  const [{ data: facData }, claimsData, issuesData] = await Promise.all([
    supabase.from("facilities").select("*").order("name"),
    selectAll<Claim>((f, t) =>
      supabase.from("claims").select("*").eq("present", true).range(f, t)
    ),
    selectAll<AuthIssue>((f, t) =>
      supabase.from("auth_issues").select("*").neq("status", "Completed").range(f, t)
    ),
  ]);

  const facilities = (facData as Facility[]) ?? [];
  // Excluded plans (e.g. VMAH member ids) are hidden from every total.
  const claims = (claimsData ?? []).filter((c) => !isExcludedMember(c.member_id));
  const issues = issuesData ?? [];

  const facName = (id: string) => {
    const f = facilities.find((x) => x.id === id);
    return f?.short_name || f?.name || "—";
  };

  // Per-facility aggregation.
  type Agg = {
    id: string;
    name: string;
    charged: number;
    balance: number;
    recovered: number;
    riskCount: number;
    riskBalance: number;
    openIssues: number;
  };
  const aggMap: Record<string, Agg> = {};
  for (const f of facilities) {
    aggMap[f.id] = {
      id: f.id,
      name: f.short_name || f.name,
      charged: 0,
      balance: 0,
      recovered: 0,
      riskCount: 0,
      riskBalance: 0,
      openIssues: 0,
    };
  }
  for (const c of claims) {
    const a = aggMap[c.facility_id];
    if (!a) continue;
    a.charged += c.charge_amount ?? 0;
    a.balance += c.balance ?? 0;
    if ((c.age_days ?? 0) > RISK_AGE_THRESHOLD) {
      a.riskCount++;
      a.riskBalance += c.balance ?? 0;
    }
  }
  for (const a of Object.values(aggMap)) a.recovered = a.charged - a.balance;
  for (const i of issues) {
    if (i.facility_id && aggMap[i.facility_id]) aggMap[i.facility_id].openIssues++;
  }
  const aggs = Object.values(aggMap).sort((a, b) => b.balance - a.balance);

  // Network totals.
  const totals = aggs.reduce(
    (s, a) => ({
      charged: s.charged + a.charged,
      balance: s.balance + a.balance,
      recovered: s.recovered + a.recovered,
      riskCount: s.riskCount + a.riskCount,
      riskBalance: s.riskBalance + a.riskBalance,
      openIssues: s.openIssues + a.openIssues,
    }),
    { charged: 0, balance: 0, recovered: 0, riskCount: 0, riskBalance: 0, openIssues: 0 }
  );

  // Worst offenders — highest-balance 65+ day claims.
  const worst = claims
    .filter((c) => (c.age_days ?? 0) > RISK_AGE_THRESHOLD)
    .sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0))
    .slice(0, 30);

  const exportRows: ExportRow[] = claims
    .filter((c) => (c.age_days ?? 0) > RISK_AGE_THRESHOLD)
    .sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0))
    .map((c) => ({
      Facility: facName(c.facility_id),
      "Claim ID": c.claim_id,
      Patient: c.patient_name ?? "",
      "Member ID": c.member_id ?? "",
      "DOS From": c.dos_from ?? "",
      "DOS To": c.dos_to ?? "",
      "Age (Days)": c.age_days ?? 0,
      Charge: c.charge_amount ?? 0,
      Balance: c.balance ?? 0,
      Status: c.claim_status ?? "",
    }));

  return (
    <>
      <Header profile={profile} email={email} subtitle="Network Overview" />
      <main className="min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          {/* Network totals */}
          <section className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <Stat label="Charged" value={money(totals.charged)} />
            <Stat
              label="Recovered"
              value={money(totals.recovered)}
              accent="recovered"
            />
            <Stat label="Outstanding" value={money(totals.balance)} accent="gold" />
            <Stat
              label="65+ Risk Claims"
              value={String(totals.riskCount)}
              accent="risk"
            />
            <Stat label="Open Auth Issues" value={String(totals.openIssues)} accent="secured" />
          </section>

          {/* High-risk management panel */}
          <section className="card overflow-hidden border-risk/30">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border bg-risk/5 px-5 py-4">
              <div>
                <h2 className="font-display text-lg font-bold text-risk">
                  High-Risk · Over 65 Days
                </h2>
                <p className="text-sm text-surface-muted">
                  {totals.riskCount} claims ·{" "}
                  <span className="font-semibold text-risk">
                    {money(totals.riskBalance)}
                  </span>{" "}
                  at risk across the network
                </p>
              </div>
              <ExportButton
                rows={exportRows}
                filename="high-risk-65day.xlsx"
                sheet="High Risk 65+"
                label="Export 65+ to Excel"
              />
            </div>
            <div className="scroll-x max-h-[24rem] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-card">
                  <tr>
                    <th className="th">Patient</th>
                    <th className="th">Facility</th>
                    <th className="th">Age</th>
                    <th className="th">DOS</th>
                    <th className="th text-right">Balance</th>
                    <th className="th">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {worst.map((c, idx) => (
                    <tr key={c.claim_id} className={idx % 2 ? "bg-surface/40" : ""}>
                      <td className="td font-medium">{c.patient_name || "—"}</td>
                      <td className="td text-xs text-surface-muted">
                        {facName(c.facility_id)}
                      </td>
                      <td className="td">
                        <span className="badge bg-risk/12 font-mono text-risk">
                          {c.age_days ?? 0}d
                        </span>
                      </td>
                      <td className="td text-xs text-surface-muted">
                        {c.dos_from || "—"}
                      </td>
                      <td className="td text-right font-mono font-semibold">
                        {money(c.balance)}
                      </td>
                      <td className="td text-xs">{c.claim_status || "—"}</td>
                    </tr>
                  ))}
                  {worst.length === 0 && (
                    <tr>
                      <td colSpan={6} className="td py-8 text-center text-surface-muted">
                        No claims over 65 days. 🎉
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Per-facility table */}
          <section className="card overflow-hidden">
            <div className="border-b border-surface-border px-5 py-3 font-semibold">
              Per-Facility Breakdown
            </div>
            <div className="scroll-x overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface">
                  <tr>
                    <th className="th">Facility</th>
                    <th className="th text-right">Charged</th>
                    <th className="th text-right">Recovered</th>
                    <th className="th text-right">Outstanding</th>
                    <th className="th text-right">65+ Risk</th>
                    <th className="th text-right">Open Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {aggs.map((a, idx) => (
                    <tr key={a.id} className={idx % 2 ? "bg-surface/40" : ""}>
                      <td className="td font-medium">{a.name}</td>
                      <td className="td text-right font-mono">{money(a.charged)}</td>
                      <td className="td text-right font-mono text-recovered">
                        {money(a.recovered)}
                      </td>
                      <td className="td text-right font-mono">{money(a.balance)}</td>
                      <td className="td text-right">
                        {a.riskCount > 0 ? (
                          <span className="font-semibold text-risk">
                            {a.riskCount}
                          </span>
                        ) : (
                          <span className="text-surface-muted">0</span>
                        )}
                      </td>
                      <td className="td text-right">
                        {a.openIssues > 0 ? (
                          <span className="font-semibold text-secured">
                            {a.openIssues}
                          </span>
                        ) : (
                          <span className="text-surface-muted">0</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-surface-border bg-surface font-semibold">
                    <td className="td">Network total</td>
                    <td className="td text-right font-mono">{money(totals.charged)}</td>
                    <td className="td text-right font-mono text-recovered">
                      {money(totals.recovered)}
                    </td>
                    <td className="td text-right font-mono">{money(totals.balance)}</td>
                    <td className="td text-right text-risk">{totals.riskCount}</td>
                    <td className="td text-right text-secured">{totals.openIssues}</td>
                  </tr>
                </tfoot>
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
  accent,
}: {
  label: string;
  value: string;
  accent?: "recovered" | "risk" | "gold" | "secured";
}) {
  const color =
    accent === "recovered"
      ? "text-recovered"
      : accent === "risk"
        ? "text-risk"
        : accent === "gold"
          ? "text-gold"
          : accent === "secured"
            ? "text-secured"
            : "text-surface-ink";
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className={`font-display text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}
