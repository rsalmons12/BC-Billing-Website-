"use client";

import TrackerModule, { SumCard, type TrackerConfig } from "@/components/trackers/TrackerModule";
import { parseMedicalRecords } from "@/lib/import/parseTrackers";
import { money } from "@/lib/format";
import { RECORD_STATUS_OPTIONS, type Facility } from "@/lib/types";

const num = (v: unknown) => (typeof v === "number" ? v : 0);

// Status buckets to surface at the top, in workflow order. "Received" folds in
// the ways records arrive (Faxed / Electronically / Mailed) so the count
// reflects everything actually in hand.
const RECEIVED_STATES = new Set(["received", "faxed", "electronically", "mailed"]);

// Visual summary: a count per record status plus charge/paid totals. Uses the
// currently filtered rows (respects the facility + month filters).
function renderSummary(rows: Array<Record<string, unknown>>) {
  const counts = { requested: 0, received: 0, appeal: 0, denied: 0, approved: 0, blank: 0 };
  let totalCharge = 0;
  let totalPaid = 0;
  for (const r of rows) {
    totalCharge += num(r.charge_amount);
    totalPaid += num(r.paid_amount);
    const s = String(r.record_status ?? "").trim().toLowerCase();
    if (!s) counts.blank += 1;
    else if (s === "requested") counts.requested += 1;
    else if (RECEIVED_STATES.has(s)) counts.received += 1;
    else if (s === "appeal") counts.appeal += 1;
    else if (s === "denied") counts.denied += 1;
    else if (s === "approved") counts.approved += 1;
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <SumCard label="Requested" value={String(counts.requested)} />
        <SumCard label="Received" value={String(counts.received)} accent="secured" />
        <SumCard label="Appeal" value={String(counts.appeal)} accent="gold" />
        <SumCard label="Denied" value={String(counts.denied)} accent="risk" />
        <SumCard label="Approved" value={String(counts.approved)} accent="recovered" />
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
