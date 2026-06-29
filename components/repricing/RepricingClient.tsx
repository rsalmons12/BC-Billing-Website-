"use client";

import TrackerModule, { type TrackerConfig } from "@/components/trackers/TrackerModule";
import { parseRepricing } from "@/lib/import/parseTrackers";
import type { Facility } from "@/lib/types";

const num = (v: unknown) => (typeof v === "number" ? v : 0);

const config: TrackerConfig = {
  table: "repricing",
  statusKey: "claim_status",
  searchKeys: ["claim_id", "patient_name", "member_id", "payer", "remark_codes", "claim_status"],
  parse: (buf) => parseRepricing(buf),
  columns: [
    { key: "claim_id", label: "Claim ID", kind: "text", editable: true, min: "min-w-[9rem]" },
    { key: "patient_name", label: "Patient", kind: "text", editable: true, min: "min-w-[11rem]" },
    { key: "member_id", label: "Member ID", kind: "text", editable: true },
    { key: "claim_from", label: "From", kind: "text", editable: true },
    { key: "payer", label: "Payer", kind: "text", editable: true },
    { key: "remark_codes", label: "Remark Codes", kind: "text", editable: true, min: "min-w-[9rem]" },
    { key: "claim_status", label: "Status", kind: "text", editable: true, min: "min-w-[10rem]" },
    { key: "total_amount", label: "Total", kind: "money", editable: true },
    { key: "amount_paid", label: "Paid", kind: "money", editable: true },
    { key: "additional_paid", label: "Add'l Paid", kind: "money", editable: true },
    // Computed: total paid = paid + additional, and % of total billed.
    {
      key: "total_paid",
      label: "Total Paid",
      kind: "money",
      compute: (r) => num(r.amount_paid) + num(r.additional_paid),
    },
    {
      key: "paid_pct",
      label: "Paid %",
      kind: "pct",
      compute: (r) => {
        const total = num(r.total_amount);
        return total > 0 ? (num(r.amount_paid) + num(r.additional_paid)) / total : null;
      },
    },
    { key: "notes", label: "Notes", kind: "notes", editable: true },
  ],
};

export default function RepricingClient({
  facilities,
  userId,
}: {
  facilities: Facility[];
  userId: string;
}) {
  return <TrackerModule facilities={facilities} userId={userId} config={config} />;
}
