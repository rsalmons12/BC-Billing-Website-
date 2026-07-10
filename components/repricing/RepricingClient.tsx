"use client";

import TrackerModule, { SumCard, type TrackerConfig } from "@/components/trackers/TrackerModule";
import { parseRepricing } from "@/lib/import/parseTrackers";
import { money } from "@/lib/format";
import type { Facility } from "@/lib/types";

const num = (v: unknown) => (typeof v === "number" ? v : 0);

// One count tile per payment status, plus a "No status" tile for unworked rows.
const STATUS_TILES: { key: string; label: string; accent?: "recovered" | "gold" | "risk" | "secured" }[] = [
  { key: "pending", label: "Pending", accent: "gold" },
  { key: "approved", label: "Approved", accent: "recovered" },
  { key: "denied", label: "Denied", accent: "risk" },
  { key: "not worked", label: "Not Worked", accent: "secured" },
  { key: "__blank__", label: "No status", accent: "risk" },
];

// Visual summary: a count per payment status plus collection totals. Uses the
// currently filtered rows (respects the facility + search filters).
function renderSummary(rows: Array<Record<string, unknown>>) {
  const counts: Record<string, number> = {};
  let charge = 0;
  let allowed = 0;
  let addl = 0;
  for (const r of rows) {
    charge += num(r.charge_amount);
    allowed += num(r.amt_allowed);
    addl += num(r.additional_payment);
    const s = String(r.payment_status ?? "").trim().toLowerCase();
    const key = s || "__blank__";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const collected = allowed + addl;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {STATUS_TILES.map((t) => (
          <SumCard key={t.key} label={t.label} value={String(counts[t.key] ?? 0)} accent={t.accent} />
        ))}
        <SumCard label="Claims" value={String(rows.length)} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SumCard label="Total Charged" value={money(charge)} />
        <SumCard label="Total Collected" value={money(collected)} accent="recovered" />
        <SumCard label="Add'l Payments" value={money(addl)} accent="secured" />
        <SumCard
          label="Collected %"
          value={charge > 0 ? `${Math.round((collected / charge) * 100)}%` : "—"}
          accent="gold"
        />
      </div>
    </div>
  );
}

const config: TrackerConfig = {
  table: "repricing",
  defaultSortKey: "patient_name",
  statusKey: "payment_status",
  statusOptions: ["Pending", "Approved", "Denied", "Not Worked"],
  searchKeys: ["claim_id", "patient_name", "member_id", "payer", "remark_codes", "claim_status"],
  parse: (buf) => parseRepricing(buf),
  renderSummary,
  // Re-imports match by Claim ID and refresh only the imported facts, so the
  // collector's note/action, follow-up, additional payment and payment status
  // are never overwritten.
  importKey: "claim_id",
  importFactKeys: [
    "facility_id",
    "patient_name",
    "member_id",
    "claim_date",
    "charge_amount",
    "amt_allowed",
    "payer",
    "remark_codes",
    "claim_status",
  ],
  columns: [
    { key: "claim_id", label: "Claim ID", kind: "text", min: "min-w-[9rem]" },
    { key: "patient_name", label: "Patient", kind: "text", editable: true, min: "min-w-[11rem]" },
    { key: "member_id", label: "Member ID", kind: "text", editable: true },
    { key: "claim_date", label: "Claim Date", kind: "text", editable: true },
    { key: "payer", label: "Payer", kind: "text", editable: true },
    { key: "remark_codes", label: "Remark Codes", kind: "text", editable: true, min: "min-w-[9rem]" },
    { key: "claim_status", label: "Claim Status", kind: "text", editable: true, min: "min-w-[10rem]" },
    { key: "charge_amount", label: "Charge", kind: "money", editable: true },
    { key: "amt_allowed", label: "Allowed", kind: "money", editable: true },
    { key: "additional_payment", label: "Add'l Pmt", kind: "money", editable: true },
    {
      key: "total_collected",
      label: "Total",
      kind: "money",
      compute: (r) => num(r.amt_allowed) + num(r.additional_payment),
    },
    {
      key: "collected_pct",
      label: "Collected %",
      kind: "pct",
      compute: (r) => {
        const charge = num(r.charge_amount);
        return charge > 0 ? (num(r.amt_allowed) + num(r.additional_payment)) / charge : null;
      },
    },
    {
      key: "payment_status",
      label: "Payment Status",
      kind: "select",
      options: ["", "Pending", "Approved", "Denied", "Not Worked"],
      editable: true,
      min: "min-w-[9rem]",
    },
    { key: "follow_up", label: "Follow Up", kind: "text", editable: true, min: "min-w-[8rem]" },
    { key: "note_action", label: "Note / Action", kind: "notes", editable: true },
  ],
};

export default function RepricingClient({
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
