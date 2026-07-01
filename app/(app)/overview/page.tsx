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
  PRIORITY_AGE_THRESHOLD,
  type Claim,
  type AuthIssue,
  type Facility,
} from "@/lib/types";

// Age band helpers. 100+ is the top priority tier; 65–99 is the risk band.
const isPriority = (c: Claim) => (c.age_days ?? 0) >= PRIORITY_AGE_THRESHOLD;
const isRisk65 = (c: Claim) =>
  (c.age_days ?? 0) > RISK_AGE_THRESHOLD && (c.age_days ?? 0) < PRIORITY_AGE_THRESHOLD;

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

  // Per-facility aggregation, split into the 100+ and 65–99 bands.
  type Agg = {
    id: string;
    name: string;
    charged: number;
    balance: number;
    recovered: number;
    pri100Count: number;
    pri100Balance: number;
    risk65Count: number;
    risk65Balance: number;
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
      pri100Count: 0,
      pri100Balance: 0,
      risk65Count: 0,
      risk65Balance: 0,
      openIssues: 0,
    };
  }
  for (const c of claims) {
    const a = aggMap[c.facility_id];
    if (!a) continue;
    a.charged += c.charge_amount ?? 0;
    a.balance += c.balance ?? 0;
    if (isPriority(c)) {
      a.pri100Count++;
      a.pri100Balance += c.balance ?? 0;
    } else if (isRisk65(c)) {
      a.risk65Count++;
      a.risk65Balance += c.balance ?? 0;
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
      pri100Count: s.pri100Count + a.pri100Count,
      pri100Balance: s.pri100Balance + a.pri100Balance,
      risk65Count: s.risk65Count + a.risk65Count,
      risk65Balance: s.risk65Balance + a.risk65Balance,
      openIssues: s.openIssues + a.openIssues,
    }),
    {
      charged: 0, balance: 0, recovered: 0,
      pri100Count: 0, pri100Balance: 0,
      risk65Count: 0, risk65Balance: 0, openIssues: 0,
    }
  );

  const byBalance = (a: Claim, b: Claim) => (b.balance ?? 0) - (a.balance ?? 0);
  const worst100 = claims.filter(isPriority).sort(byBalance).slice(0, 30);
  const worst65 = claims.filter(isRisk65).sort(byBalance).slice(0, 30);

  const toExport = (list: Claim[]): ExportRow[] =>
    list.map((c) => ({
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
  const export100 = toExport(claims.filter(isPriority).sort(byBalance));
  const export65 = toExport(claims.filter(isRisk65).sort(byBalance));

  return (
    <>
      <Header profile={profile} email={email} subtitle="Network Overview" />
      <main className="min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          {/* Network totals */}
          <section className="grid grid-cols-2 gap-4 md:grid-cols-6">
            <Stat label="Charged" value={money(totals.charged)} />
            <Stat label="Recovered" value={money(totals.recovered)} accent="recovered" />
            <Stat label="Outstanding" value={money(totals.balance)} accent="gold" />
            <Stat label="100+ Priority" value={String(totals.pri100Count)} accent="risk" />
            <Stat label="65–99 Risk" value={String(totals.risk65Count)} accent="gold" />
            <Stat label="Open Auth Issues" value={String(totals.openIssues)} accent="secured" />
          </section>

          {/* 100+ priority panel */}
          <RiskPanel
            title="Priority · 100+ Days"
            accent="risk"
            count={totals.pri100Count}
            balance={totals.pri100Balance}
            rows={worst100}
            facName={facName}
            emptyMsg="No claims 100+ days. 🎉"
            exportRows={export100}
            exportName="priority-100day.xlsx"
            exportSheet="Priority 100+"
            exportLabel="Export 100+ to Excel"
          />

          {/* 65–99 risk panel */}
          <RiskPanel
            title="Risk · 65–99 Days"
            accent="gold"
            count={totals.risk65Count}
            balance={totals.risk65Balance}
            rows={worst65}
            facName={facName}
            emptyMsg="No claims in the 65–99 day band. 🎉"
            exportRows={export65}
            exportName="risk-65to99day.xlsx"
            exportSheet="Risk 65-99"
            exportLabel="Export 65–99 to Excel"
          />

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
                    <th className="th text-right">100+</th>
                    <th className="th text-right">65–99</th>
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
                        {a.pri100Count > 0 ? (
                          <span className="font-bold text-risk">{a.pri100Count}</span>
                        ) : (
                          <span className="text-surface-muted">0</span>
                        )}
                      </td>
                      <td className="td text-right">
                        {a.risk65Count > 0 ? (
                          <span className="font-semibold text-gold">{a.risk65Count}</span>
                        ) : (
                          <span className="text-surface-muted">0</span>
                        )}
                      </td>
                      <td className="td text-right">
                        {a.openIssues > 0 ? (
                          <span className="font-semibold text-secured">{a.openIssues}</span>
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
                    <td className="td text-right text-risk">{totals.pri100Count}</td>
                    <td className="td text-right text-gold">{totals.risk65Count}</td>
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

function RiskPanel({
  title,
  accent,
  count,
  balance,
  rows,
  facName,
  emptyMsg,
  exportRows,
  exportName,
  exportSheet,
  exportLabel,
}: {
  title: string;
  accent: "risk" | "gold";
  count: number;
  balance: number;
  rows: Claim[];
  facName: (id: string) => string;
  emptyMsg: string;
  exportRows: ExportRow[];
  exportName: string;
  exportSheet: string;
  exportLabel: string;
}) {
  const text = accent === "risk" ? "text-risk" : "text-gold";
  const bg = accent === "risk" ? "bg-risk/5" : "bg-gold/5";
  const badge = accent === "risk" ? "bg-risk/12 text-risk" : "bg-gold/15 text-gold";
  return (
    <section className={`card overflow-hidden ${accent === "risk" ? "border-risk/30" : "border-gold/30"}`}>
      <div className={`flex flex-wrap items-center justify-between gap-3 border-b border-surface-border ${bg} px-5 py-4`}>
        <div>
          <h2 className={`font-display text-lg font-bold ${text}`}>{title}</h2>
          <p className="text-sm text-surface-muted">
            {count} claims ·{" "}
            <span className={`font-semibold ${text}`}>{money(balance)}</span> across the network
          </p>
        </div>
        <ExportButton rows={exportRows} filename={exportName} sheet={exportSheet} label={exportLabel} />
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
            {rows.map((c, idx) => (
              <tr key={c.claim_id} className={idx % 2 ? "bg-surface/40" : ""}>
                <td className="td font-medium">{c.patient_name || "—"}</td>
                <td className="td text-xs text-surface-muted">{facName(c.facility_id)}</td>
                <td className="td">
                  <span className={`badge font-mono ${badge}`}>{c.age_days ?? 0}d</span>
                </td>
                <td className="td text-xs text-surface-muted">{c.dos_from || "—"}</td>
                <td className="td text-right font-mono font-semibold">{money(c.balance)}</td>
                <td className="td text-xs">{c.claim_status || "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="td py-8 text-center text-surface-muted">
                  {emptyMsg}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
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
