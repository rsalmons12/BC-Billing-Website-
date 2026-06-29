"use client";

import TrackerModule, { type TrackerConfig } from "@/components/trackers/TrackerModule";
import { parsePayments } from "@/lib/import/parseTrackers";
import { money } from "@/lib/format";
import type { Facility } from "@/lib/types";

const num = (v: unknown) => (typeof v === "number" ? v : 0);

// Visual summary: total collected + collected per CPT (with %). Uses the
// currently filtered rows (respects the facility filter).
function renderSummary(rows: Array<Record<string, unknown>>) {
  const totalPaid = rows.reduce((s, r) => s + num(r.paid_amount), 0);
  const totalCharge = rows.reduce((s, r) => s + num(r.charge_amount), 0);

  const byCpt = new Map<string, { paid: number; count: number }>();
  for (const r of rows) {
    const cpt = String(r.cpt_description || "—");
    const cur = byCpt.get(cpt) ?? { paid: 0, count: 0 };
    cur.paid += num(r.paid_amount);
    cur.count += 1;
    byCpt.set(cpt, cur);
  }
  const cpts = Array.from(byCpt.entries())
    .map(([cpt, v]) => ({ cpt, ...v, pct: totalPaid > 0 ? v.paid / totalPaid : 0 }))
    .sort((a, b) => b.paid - a.paid);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SumCard label="Total Collected" value={money(totalPaid)} accent="recovered" />
        <SumCard label="Total Charged" value={money(totalCharge)} />
        <SumCard
          label="Collection %"
          value={totalCharge > 0 ? `${Math.round((totalPaid / totalCharge) * 100)}%` : "—"}
          accent="gold"
        />
        <SumCard label="Payments" value={String(rows.length)} />
      </div>
      {cpts.length > 0 && (
        <div className="card overflow-hidden">
          <div className="border-b border-surface-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-surface-muted">
            Collected per CPT / Level of Care
          </div>
          <div className="max-h-44 overflow-auto">
            <table className="w-full text-sm">
              <tbody>
                {cpts.map((c) => (
                  <tr key={c.cpt} className="border-b border-surface-border last:border-0">
                    <td className="td font-medium">{c.cpt}</td>
                    <td className="td text-right text-surface-muted">{c.count}</td>
                    <td className="td text-right font-mono">{money(c.paid)}</td>
                    <td className="td w-40">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface">
                          <div
                            className="h-full rounded-full bg-recovered"
                            style={{ width: `${Math.min(c.pct * 100, 100)}%` }}
                          />
                        </div>
                        <span className="w-10 text-right font-mono text-xs">
                          {Math.round(c.pct * 100)}%
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

function SumCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "recovered" | "gold";
}) {
  const color =
    accent === "recovered" ? "text-recovered" : accent === "gold" ? "text-gold" : "text-surface-ink";
  return (
    <div className="card p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-surface-muted">
        {label}
      </div>
      <div className={`font-display text-xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

const config: TrackerConfig = {
  table: "payments",
  searchKeys: ["patient_name", "member_id", "payment_source", "check_number", "cpt_description"],
  parse: (buf) => parsePayments(buf),
  // Re-importing a facility's payment file refreshes that facility's rows
  // (replace), so re-uploading never double-counts. Other facilities are
  // untouched.
  renderSummary,
  columns: [
    { key: "patient_name", label: "Patient", kind: "text", min: "min-w-[11rem]" },
    { key: "member_id", label: "Member ID", kind: "text" },
    { key: "cpt_description", label: "CPT", kind: "text", min: "min-w-[9rem]" },
    { key: "payment_source", label: "Payer", kind: "text" },
    { key: "dos_from", label: "DOS From", kind: "text" },
    { key: "dos_to", label: "DOS To", kind: "text" },
    { key: "charge_amount", label: "Charge", kind: "money" },
    { key: "paid_amount", label: "Paid", kind: "money" },
    { key: "deposit_date", label: "Deposit", kind: "text" },
    { key: "payment_type", label: "Type", kind: "text", min: "min-w-[5rem]" },
    { key: "check_number", label: "Check #", kind: "text" },
    { key: "notes", label: "Notes", kind: "notes", editable: true },
  ],
};

export default function PaymentsClient({
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
