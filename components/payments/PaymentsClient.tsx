"use client";

import TrackerModule, { type TrackerConfig } from "@/components/trackers/TrackerModule";
import { parsePayments } from "@/lib/import/parseTrackers";
import type { Facility } from "@/lib/types";

const config: TrackerConfig = {
  table: "payments",
  searchKeys: ["patient_name", "member_id", "payment_source", "check_number", "cpt_description"],
  parse: (buf) => parsePayments(buf),
  columns: [
    { key: "patient_name", label: "Patient", kind: "text", editable: true, min: "min-w-[11rem]" },
    { key: "member_id", label: "Member ID", kind: "text", editable: true },
    { key: "cpt_description", label: "CPT", kind: "text", editable: true, min: "min-w-[9rem]" },
    { key: "payment_source", label: "Payer", kind: "text", editable: true },
    { key: "dos_from", label: "DOS From", kind: "text", editable: true },
    { key: "dos_to", label: "DOS To", kind: "text", editable: true },
    { key: "charge_amount", label: "Charge", kind: "money", editable: true },
    { key: "paid_amount", label: "Paid", kind: "money", editable: true },
    { key: "deposit_date", label: "Deposit", kind: "text", editable: true },
    { key: "payment_type", label: "Type", kind: "text", editable: true, min: "min-w-[5rem]" },
    { key: "check_number", label: "Check #", kind: "text", editable: true },
    { key: "notes", label: "Notes", kind: "notes", editable: true },
  ],
};

export default function PaymentsClient({
  facilities,
  userId,
}: {
  facilities: Facility[];
  userId: string;
}) {
  return <TrackerModule facilities={facilities} userId={userId} config={config} />;
}
