"use client";

import TrackerModule, { SumCard, type TrackerConfig } from "@/components/trackers/TrackerModule";
import { parseMedicalRecords } from "@/lib/import/parseTrackers";
import { money } from "@/lib/format";
import { RECORD_STATUS_OPTIONS, type Facility } from "@/lib/types";

const num = (v: unknown) => (typeof v === "number" ? v : 0);

// Every record status gets its own count tile, plus a "No status" tile for
// rows that haven't been marked yet.
const STATUS_TILES: { key: string; label: string; accent?: "recovered" | "gold" | "risk" | "secured" }[] = [
  { key: "requested", label: "Requested" },
  { key: "received", label: "Received", accent: "secured" },
  { key: "faxed", label: "Faxed", accent: "secured" },
  { key: "electronically", label: "Electronically", accent: "secured" },
  { key: "mailed", label: "Mailed", accent: "secured" },
  { key: "appeal", label: "Appeal", accent: "gold" },
  { key: "denied", label: "Denied", accent: "risk" },
  { key: "approved", label: "Approved", accent: "recovered" },
  { key: "__blank__", label: "No status", accent: "risk" },
];

// Visual summary: a count per record status plus charge/paid totals. Uses the
// currently filtered rows (respects the facility + month filters).
function renderSummary(rows: Array<Record<string, unknown>>) {
  const counts: Record<string, number> = {};
  let totalCharge = 0;
  let totalPaid = 0;
  for (const r of rows) {
    totalCharge += num(r.charge_amount);
    totalPaid += num(r.paid_amount);
    const s = String(r.record_status ?? "").trim().toLowerCase();
    const key = s || "__blank__";
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {STATUS_TILES.map((t) => (
          <SumCard key={t.key} label={t.label} value={String(counts[t.key] ?? 0)} accent={t.accent} />
        ))}
        <SumCard label="Records" value={String(rows.length)} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SumCard label="Total Charged" value={money(totalCharge)} />
        <SumCard label="Total Paid" value={money(totalPaid)} accent="recovered" />
      </div>
    </div>
  );
}

const config: TrackerConfig = {
  table: "medical_records",
  defaultSortKey: "patient_name",
  statusKey: "record_status",
  statusOptions: RECORD_STATUS_OPTIONS,
  searchKeys: ["patient_name", "payer", "dcn", "record_status", "claim_status"],
  parse: (buf) => parseMedicalRecords(buf),
  renderSummary,
  columns: [
    { key: "patient_name", label: "Patient", kind: "text", editable: true, min: "min-w-[11rem]" },
    { key: "dos_from", label: "DOS From", kind: "text", editable: true },
    { key: "dos_to", label: "DOS To", kind: "text", editable: true },
    { key: "payer", label: "Payer", kind: "text", editable: true },
    { key: "charge_amount", label: "Charge", kind: "money", editable: true },
    { key: "record_status", label: "Record Status", kind: "select", options: RECORD_STATUS_OPTIONS, editable: true, min: "min-w-[9rem]" },
    { key: "claim_status", label: "Claim Status", kind: "text", editable: true },
    { key: "date_received", label: "Date Rec'd", kind: "text", editable: true },
    { key: "dcn", label: "DCN", kind: "text", editable: true },
    { key: "pages", label: "Pages", kind: "text", editable: true, min: "min-w-[5rem]" },
    { key: "paid_amount", label: "Paid", kind: "money", editable: true },
    { key: "notes", label: "Notes", kind: "notes", editable: true },
  ],
};

export default function MedicalRecordsClient({
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
