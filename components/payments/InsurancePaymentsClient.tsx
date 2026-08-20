"use client";

import TrackerModule, { SumCard, type TrackerConfig } from "@/components/trackers/TrackerModule";
import { parsePayments } from "@/lib/import/parseTrackers";
import { money } from "@/lib/format";
import type { Facility } from "@/lib/types";

const num = (v: unknown) => (typeof v === "number" ? v : 0);

// Visual summary for the insurance-deposit report: total collected + a
// breakdown by insurance (payer). No patient / CPT detail — this report is
// keyed by payer + check, not by patient.
function renderSummary(rows: Array<Record<string, unknown>>) {
  const totalPaid = rows.reduce((s, r) => s + num(r.paid_amount), 0);

  const byPayer = new Map<string, { paid: number; count: number }>();
  for (const r of rows) {
    const payer = String(r.payment_source || "—").toUpperCase();
    const cur = byPayer.get(payer) ?? { paid: 0, count: 0 };
    cur.paid += num(r.paid_amount);
    cur.count += 1;
    byPayer.set(payer, cur);
  }
  const payers = Array.from(byPayer.entries())
    .map(([payer, v]) => ({ payer, ...v, pct: totalPaid > 0 ? v.paid / totalPaid : 0 }))
    .sort((a, b) => b.paid - a.paid);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <SumCard label="Total Collected" value={money(totalPaid)} accent="recovered" />
        <SumCard label="Checks / Lines" value={String(rows.length)} />
        <SumCard label="Payers" value={String(payers.length)} accent="gold" />
      </div>
      {payers.length > 0 && (
        <div className="card overflow-hidden">
          <div className="border-b border-surface-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-surface-muted">
            Collected per Insurance (Payer)
          </div>
          <div className="max-h-44 overflow-auto">
            <table className="w-full text-sm">
              <tbody>
                {payers.map((p) => (
                  <tr key={p.payer} className="border-b border-surface-border last:border-0">
                    <td className="td font-medium">{p.payer}</td>
                    <td className="td text-right text-surface-muted">{p.count}</td>
                    <td className="td text-right font-mono">{money(p.paid)}</td>
                    <td className="td w-40">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface">
                          <div
                            className="h-full rounded-full bg-recovered"
                            style={{ width: `${Math.min(p.pct * 100, 100)}%` }}
                          />
                        </div>
                        <span className="w-10 text-right font-mono text-xs">
                          {Math.round(p.pct * 100)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// Insurance-deposit report: "Credit Payer Name / Payment Check # / Insurance
// Paid Amount (Sum) / Deposit Date". No patient column — each row is a
// remittance keyed by payer + check. Writes to the SAME payments table, so its
// amounts flow straight into the daily recap and monthly overview's Collected.
// Importing a month replaces just that month for the facility (so re-importing
// refreshes it; other months stay put) — one authoritative payment set per
// facility per month, which keeps Collected from double-counting.
const config: TrackerConfig = {
  table: "payments",
  defaultSortKey: "payment_source",
  payerKey: "payment_source",
  searchKeys: ["payment_source", "check_number"],
  parse: (buf) => parsePayments(buf),
  importMode: "replace_period",
  monthFrom: "deposit_date",
  renderSummary,
  columns: [
    { key: "payment_source", label: "Insurance (Payer)", kind: "text", min: "min-w-[13rem]" },
    { key: "check_number", label: "Check #", kind: "text", min: "min-w-[9rem]" },
    { key: "paid_amount", label: "Amount", kind: "money" },
    { key: "deposit_date", label: "Deposit Date", kind: "text" },
    { key: "notes", label: "Notes", kind: "notes", editable: true },
  ],
};

export default function InsurancePaymentsClient({
  facilities,
  userId,
  isManagement,
  readOnly = false,
}: {
  facilities: Facility[];
  userId: string;
  isManagement: boolean;
  readOnly?: boolean;
}) {
  return (
    <TrackerModule
      facilities={facilities}
      userId={userId}
      config={config}
      isManagement={isManagement}
      readOnly={readOnly}
    />
  );
}
