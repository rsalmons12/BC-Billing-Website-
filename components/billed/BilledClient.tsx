"use client";

import TrackerModule, {
  type TrackerConfig,
  SumCard,
} from "@/components/trackers/TrackerModule";
import { parseBilled } from "@/lib/import/parseTrackers";
import { money } from "@/lib/format";
import type { Facility } from "@/lib/types";

const config: TrackerConfig = {
  table: "billed_claims",
  defaultSortKey: "patient_name",
  payerKey: "payer_name",
  searchKeys: ["patient_name", "claim_id", "payer_name"],
  parse: (buf) => parseBilled(buf),
  // Just a visual report — no claim-id matching, no notes. Accumulates by month
  // like payments: importing a month replaces only that month for the file's
  // facilities. The Month dropdown lets facilities view any month.
  importMode: "replace_period",
  monthFrom: "period",
  columns: [
    { key: "patient_name", label: "Patient", kind: "text", editable: false, min: "min-w-[12rem]" },
    { key: "claim_id", label: "Claim ID", kind: "text", editable: false, min: "min-w-[9rem]" },
    { key: "payer_name", label: "Payer", kind: "text", editable: false, min: "min-w-[12rem]" },
    { key: "entered_date", label: "Billed", kind: "text", editable: false },
    { key: "from_date", label: "From", kind: "text", editable: false },
    { key: "to_date", label: "To", kind: "text", editable: false },
    { key: "total_amount", label: "Billed Amount", kind: "money", editable: false },
    { key: "balance", label: "Balance (AR)", kind: "money", editable: false },
  ],
  renderSummary: (rows) => {
    const billed = rows.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
    const ar = rows.reduce((s, r) => s + (Number(r.balance) || 0), 0);

    // Outstanding (AR) grouped by payer, biggest first.
    const byPayer = new Map<string, number>();
    for (const r of rows) {
      const p = String(r.payer_name || "—").trim() || "—";
      byPayer.set(p, (byPayer.get(p) ?? 0) + (Number(r.balance) || 0));
    }
    const sorted = Array.from(byPayer.entries())
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);

    // Just the visual — top payers as a simple bar chart, the long tail rolled
    // into "Other" so the summary stays a glance, not a wall of chips.
    const TOP = 6;
    const top = sorted.slice(0, TOP);
    const restTotal = sorted.slice(TOP).reduce((s, [, v]) => s + v, 0);
    const bars = restTotal > 0 ? [...top, ["Other payers", restTotal] as [string, number]] : top;
    const max = bars.length ? Math.max(...bars.map(([, v]) => v)) : 0;

    return (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <SumCard label="Claims" value={String(rows.length)} />
          <SumCard label="Billed" value={money(billed)} accent="gold" />
          <SumCard label="Outstanding (AR)" value={money(ar)} accent="risk" />
        </div>
        {bars.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-surface-muted">
              Outstanding AR by payer
            </div>
            <div className="space-y-1.5">
              {bars.map(([p, v]) => (
                <div key={p} className="flex items-center gap-3">
                  <div className="w-32 shrink-0 truncate text-xs text-surface-muted" title={p}>
                    {p}
                  </div>
                  <div className="h-4 flex-1 overflow-hidden rounded bg-surface">
                    <div
                      className="h-full rounded bg-brand-blue"
                      style={{ width: `${max > 0 ? Math.max(4, (v / max) * 100) : 0}%` }}
                    />
                  </div>
                  <div className="w-24 shrink-0 text-right text-xs font-semibold text-surface-ink">
                    {money(v)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  },
};

export default function BilledClient({
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
