"use client";

import TrackerModule, { SumCard, type TrackerConfig } from "@/components/trackers/TrackerModule";
import { parseRepricing } from "@/lib/import/parseTrackers";
import { money } from "@/lib/format";
import type { Facility } from "@/lib/types";

const num = (v: unknown) => (typeof v === "number" ? v : 0);

// ---- Repricing SLA helpers ----
// A claim is "done" when Approved (paid) or Denied. Everything else — Pending,
// Not Worked, or blank — is OPEN and belongs in the follow-up queue.
const statusOf = (r: Record<string, unknown>) => String(r.payment_status ?? "").trim().toLowerCase();
const isApproved = (r: Record<string, unknown>) => statusOf(r) === "approved";
const isDenied = (r: Record<string, unknown>) => statusOf(r) === "denied";
const isOpen = (r: Record<string, unknown>) => !isApproved(r) && !isDenied(r);
// Days since the claim was last touched (edited), falling back to when it was
// imported. Drives the 14-day turnaround: open + >14 days = LATE.
const daysUntouched = (r: Record<string, unknown>) => {
  const t = Date.parse(String(r.updated_at ?? r.created_at ?? ""));
  if (isNaN(t)) return Infinity;
  return Math.floor((Date.now() - t) / 86_400_000);
};
const SLA_DAYS = 14;
const isLate = (r: Record<string, unknown>) => isOpen(r) && daysUntouched(r) > SLA_DAYS;

// One count tile per payment status, plus a "No status" tile for unworked rows.
const STATUS_TILES: { key: string; label: string; accent?: "recovered" | "gold" | "risk" | "secured" }[] = [
  { key: "pending", label: "Pending", accent: "gold" },
  { key: "approved", label: "Approved", accent: "recovered" },
  { key: "denied", label: "Denied", accent: "risk" },
  { key: "not worked", label: "Not Worked", accent: "secured" },
  { key: "__blank__", label: "No status", accent: "risk" },
];

// Visual summary: a count per payment status plus collection totals. Uses the
// currently filtered rows (respects the facility + search filters). "Collected"
// counts Allowed + Add'l Payment ONLY on Approved (paid) claims — Pending,
// Denied and unworked claims are not collected money.
function renderSummary(rows: Array<Record<string, unknown>>) {
  const counts: Record<string, number> = {};
  let charge = 0;
  let collected = 0;
  let addl = 0;
  let lateCount = 0;
  for (const r of rows) {
    charge += num(r.charge_amount);
    if (isApproved(r)) collected += num(r.amt_allowed) + num(r.additional_payment);
    addl += num(r.additional_payment);
    if (isLate(r)) lateCount += 1;
    const s = statusOf(r);
    const key = s || "__blank__";
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {STATUS_TILES.map((t) => (
          <SumCard key={t.key} label={t.label} value={String(counts[t.key] ?? 0)} accent={t.accent} />
        ))}
        <SumCard label="Late · >14d" value={String(lateCount)} accent={lateCount > 0 ? "risk" : "recovered"} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SumCard label="Total Charged" value={money(charge)} />
        <SumCard label="Collected (Approved)" value={money(collected)} accent="recovered" />
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

const columns: TrackerConfig["columns"] = [
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
  // Where each claim stands against the 14-day turnaround, at a glance.
  {
    key: "sla_flag",
    label: "Follow-up",
    kind: "text",
    min: "min-w-[9rem]",
    compute: (r) => {
      if (isApproved(r)) return "✓ Approved";
      if (isDenied(r)) return "✕ Denied";
      const d = daysUntouched(r);
      if (!isFinite(d)) return "Open";
      if (d > SLA_DAYS) return `LATE · ${d}d`;
      if (d >= 10) return `Due soon · ${d}d`;
      return `Open · ${d}d`;
    },
  },
  { key: "follow_up", label: "Follow Up", kind: "text", editable: true, min: "min-w-[8rem]" },
  { key: "note_action", label: "Note / Action", kind: "notes", editable: true },
  {
    key: "updated_at",
    label: "Last Touched",
    kind: "text",
    min: "min-w-[8rem]",
    compute: (r) =>
      r.updated_at
        ? new Date(r.updated_at as string).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "—",
  },
];

// Follow-up buckets. Denied has its OWN bucket and is out of the open queue.
const extraFilters: TrackerConfig["extraFilters"] = {
  label: "All claims",
  options: [
    { value: "open", label: "Open · needs follow-up", test: isOpen },
    { value: "late", label: "Late · >14 days", test: isLate },
    {
      value: "duesoon",
      label: "Due soon · 10–14 days",
      test: (r) => isOpen(r) && daysUntouched(r) >= 10 && daysUntouched(r) <= SLA_DAYS,
    },
    { value: "approved", label: "Approved (paid)", test: isApproved },
    { value: "denied", label: "Denied", test: isDenied },
  ],
};

const config: TrackerConfig = {
  table: "repricing",
  defaultSortKey: "patient_name",
  statusKey: "payment_status",
  statusOptions: ["Pending", "Approved", "Denied", "Not Worked"],
  payerKey: "payer",
  // Open as a facility → payer → claims drill-down. Facility bubbles total their
  // claims; clicking one shows payer bubbles; clicking a payer opens the claims.
  // "Collected" only counts Approved (paid) claims.
  drilldown: {
    chargeKey: "charge_amount",
    collectedKeys: ["amt_allowed", "additional_payment"],
    collectedWhen: isApproved,
  },
  extraFilters,
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
  columns,
};

// Queue variant: opens on the OPEN (needs follow-up) bucket, oldest-touched
// first so the most overdue claims are at the top.
const queueConfig: TrackerConfig = {
  ...config,
  drilldown: undefined, // queue is a flat worklist, not the facility bubbles
  defaultExtraFilter: "open",
  defaultSortKey: "updated_at",
};

export default function RepricingClient({
  facilities,
  userId,
  isManagement,
  readOnly = false,
  queue = false,
}: {
  facilities: Facility[];
  userId: string;
  isManagement: boolean;
  readOnly?: boolean;
  queue?: boolean;
}) {
  return (
    <TrackerModule
      facilities={facilities}
      userId={userId}
      config={queue ? queueConfig : config}
      isManagement={isManagement}
      readOnly={readOnly}
    />
  );
}
