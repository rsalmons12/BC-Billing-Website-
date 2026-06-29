"use client";

import TrackerModule, { type TrackerConfig } from "@/components/trackers/TrackerModule";
import { parseRepricing } from "@/lib/import/parseTrackers";
import type { Facility } from "@/lib/types";

const num = (v: unknown) => (typeof v === "number" ? v : 0);

const config: TrackerConfig = {
  table: "repricing",
  statusKey: "payment_status",
  statusOptions: ["Pending", "Approved", "Denied", "Not Worked"],
  searchKeys: ["claim_id", "patient_name", "member_id", "payer", "remark_codes", "claim_status"],
  parse: (buf) => parseRepricing(buf),
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
}: {
  facilities: Facility[];
  userId: string;
}) {
  return <TrackerModule facilities={facilities} userId={userId} config={config} />;
}
