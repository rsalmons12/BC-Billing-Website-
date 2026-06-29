"use client";

import TrackerModule, { type TrackerConfig } from "@/components/trackers/TrackerModule";
import { parseNegotiations } from "@/lib/import/parseTrackers";
import { NEGOTIATION_STATUS_OPTIONS, type Facility } from "@/lib/types";

const config: TrackerConfig = {
  table: "negotiations",
  statusKey: "status",
  statusOptions: NEGOTIATION_STATUS_OPTIONS,
  searchKeys: ["patient_name", "carrier", "vendor", "negotiator", "status"],
  parse: (buf) => parseNegotiations(buf),
  columns: [
    { key: "patient_name", label: "Patient", kind: "text", editable: true, min: "min-w-[11rem]" },
    { key: "dos", label: "DOS", kind: "text", editable: true, min: "min-w-[10rem]" },
    { key: "carrier", label: "Carrier", kind: "text", editable: true },
    { key: "vendor", label: "Vendor", kind: "text", editable: true },
    { key: "charged_amount", label: "Charged", kind: "money", editable: true },
    { key: "proposed_amount", label: "Proposed", kind: "money", editable: true },
    { key: "negotiated_amount", label: "Negotiated", kind: "money", editable: true },
    { key: "approved_rate", label: "Appr %", kind: "pct" },
    { key: "status", label: "Status", kind: "select", options: NEGOTIATION_STATUS_OPTIONS, editable: true },
    { key: "date_signed", label: "Signed", kind: "text", editable: true },
    { key: "negotiator", label: "Negotiator", kind: "text", editable: true, min: "min-w-[10rem]" },
    { key: "notes", label: "Notes", kind: "notes", editable: true },
  ],
};

export default function NegotiationsClient({
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
