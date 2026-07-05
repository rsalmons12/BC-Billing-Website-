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
  searchKeys: ["patient_name", "claim_id", "payer_name"],
  parse: (buf) => parseBilled(buf),
  // Upsert by claim id so re-importing refreshes amounts/balance without
  // creating duplicates. Read-only visual report (no notes), so the import log
  // won't mention notes.
  importKey: "claim_id",
  preservesNotes: false,
  importFactKeys: [
    "times_billed",
    "from_date",
    "to_date",
    "entered_date",
    "total_amount",
    "balance",
    "patient_id",
    "patient_name",
    "payer_name",
    "payer_type",
  ],
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
    const collected = billed - ar;

    // Outstanding (AR) grouped by payer, biggest first.
    const byPayer = new Map<string, number>();
    for (const r of rows) {
      const p = String(r.payer_name || "—").trim() || "—";
      byPayer.set(p, (byPayer.get(p) ?? 0) + (Number(r.balance) || 0));
    }
    const payers = Array.from(byPayer.entries())
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);

    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <SumCard label="Claims" value={String(rows.length)} />
          <SumCard label="Billed" value={money(billed)} accent="gold" />
          <SumCard label="Outstanding (AR)" value={money(ar)} accent="risk" />
          <SumCard label="Collected" value={money(collected)} accent="recovered" />
        </div>
        {payers.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-surface-muted">
              Outstanding AR by payer
            </div>
            <div className="flex flex-wrap gap-2">
              {payers.map(([p, v]) => (
                <span key={p} className="badge bg-surface-card text-surface-muted">
                  {p}: <b className="ml-1 text-surface-ink">{money(v)}</b>
                </span>
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
