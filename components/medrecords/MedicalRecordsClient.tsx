"use client";

import TrackerModule, { type TrackerConfig } from "@/components/trackers/TrackerModule";
import { parseMedicalRecords } from "@/lib/import/parseTrackers";
import { RECORD_STATUS_OPTIONS, type Facility } from "@/lib/types";

const config: TrackerConfig = {
  table: "medical_records",
  defaultSortKey: "patient_name",
  statusKey: "record_status",
  statusOptions: RECORD_STATUS_OPTIONS,
  searchKeys: ["patient_name", "payer", "dcn", "record_status", "claim_status"],
  parse: (buf) => parseMedicalRecords(buf),
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
