"use client";

import TrackerModule, { type TrackerConfig } from "@/components/trackers/TrackerModule";
import { parseNegotiations } from "@/lib/import/parseTrackers";
import { NEGOTIATION_STATUS_OPTIONS, type Facility } from "@/lib/types";
import { money } from "@/lib/format";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const n = (v: any) => Number(v) || 0;

const config: TrackerConfig = {
  table: "negotiations",
  defaultSortKey: "patient_name",
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

  // Newest-signed deals float to the top; unsigned fall below, A–Z by patient.
  sortCompare: (a, b) => {
    const da = Date.parse(String(a.date_signed ?? "")) || 0;
    const db = Date.parse(String(b.date_signed ?? "")) || 0;
    if (da !== db) return db - da;
    return String(a.patient_name ?? "").toLowerCase().localeCompare(String(b.patient_name ?? "").toLowerCase());
  },

  // Group the deals into status sections. "Approved" = approved but not yet
  // signed (money awaiting signature), shown right under the freshly-signed set.
  groupByStatus: {
    key: "status",
    order: ["Signed", "Approved", "Proposed", "Pending", "Rejected"],
    labels: {
      Signed: "Signed — newest first",
      Approved: "Approved — awaiting signature",
      Proposed: "Proposed",
      Pending: "Pending",
      Rejected: "Rejected",
    },
    groupTotals: (rows) => {
      const charged = rows.reduce((s, r) => s + n(r.charged_amount), 0);
      const negotiated = rows.reduce((s, r) => s + n(r.negotiated_amount), 0);
      return negotiated > 0
        ? `${money(charged)} charged · ${money(negotiated)} negotiated`
        : `${money(charged)} charged`;
    },
  },

  // Summary bar: charges, negotiated, savings, money awaiting signature, avg rate.
  summaryKpis: (rows) => {
    const charged = rows.reduce((s, r) => s + n(r.charged_amount), 0);
    const negotiated = rows.reduce((s, r) => s + n(r.negotiated_amount), 0);
    const negRows = rows.filter((r) => n(r.negotiated_amount) > 0);
    const chargedOnNeg = negRows.reduce((s, r) => s + n(r.charged_amount), 0);
    const negTotal = negRows.reduce((s, r) => s + n(r.negotiated_amount), 0);
    const savings = Math.max(0, chargedOnNeg - negTotal);
    const savePct = chargedOnNeg > 0 ? Math.round((savings / chargedOnNeg) * 100) : 0;
    const approved = rows.filter((r) => String(r.status) === "Approved");
    const approvedUnsigned = approved.reduce((s, r) => s + (n(r.negotiated_amount) || n(r.proposed_amount)), 0);
    const rates = rows.map((r) => n(r.approved_rate)).filter((x) => x > 0);
    const avgRate = rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100) : 0;
    return [
      { label: "Total Charged", value: money(charged), sub: `${rows.length} deal${rows.length === 1 ? "" : "s"}` },
      { label: "Negotiated", value: money(negotiated), tone: "blue", sub: "agreed / approved" },
      { label: "Savings", value: money(savings), tone: "green", sub: savePct ? `${savePct}% off charges` : "—" },
      { label: "Approved · unsigned", value: money(approvedUnsigned), tone: "gold", sub: `${approved.length} awaiting signature` },
      { label: "Avg approved rate", value: avgRate ? `${avgRate}%` : "—", sub: "of charged" },
    ];
  },
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
