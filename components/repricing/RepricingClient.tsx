"use client";

import TrackerModule, { SumCard, type TrackerConfig } from "@/components/trackers/TrackerModule";
import { parseRepricing } from "@/lib/import/parseTrackers";
import { payerBucket } from "@/lib/payer";
import { money } from "@/lib/format";
import type { Facility } from "@/lib/types";

const num = (v: unknown) => (typeof v === "number" ? v : 0);

// Queue work-order by payer family — what to work first. BCBS is ALWAYS last.
// Commercial payers that reprice well come first; government payers next;
// anything unrecognized sits just before BCBS.
const PAYER_PRIORITY = ["Aetna", "Cigna", "United", "Humana", "Tricare", "Medicare", "Medicaid"];
const payerRank = (r: Record<string, unknown>): number => {
  const b = payerBucket(r.payer);
  if (b === "BCBS") return 999; // always last
  const i = PAYER_PRIORITY.indexOf(b);
  return i === -1 ? 500 : i; // unknown/Other just before BCBS
};
const queueLevelLabel = (r: Record<string, unknown>): string => {
  const rnk = payerRank(r);
  if (rnk >= 999) return "Last · BCBS";
  if (rnk >= 500) return "Lv 8 · Other";
  return `Lv ${rnk + 1} · ${payerBucket(r.payer)}`;
};

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

// ---- Appeal-window helpers ----
// After the payer PAYS a claim, there's a limited window to appeal for more
// payment. The clock runs from the payment date and the length depends on the
// payer: Cigna = 90 days, Aetna (a.k.a. GCS) = 180 days. Add more here as needed.
const appealWindowDays = (r: Record<string, unknown>): number | undefined => {
  const p = String(r.payer ?? "").toLowerCase();
  if (/cigna|evernorth/.test(p)) return 90;
  if (/aetna|\bgcs\b/.test(p)) return 180;
  return undefined;
};
const parseDay = (v: unknown): number | null => {
  const t = Date.parse(String(v ?? "").trim());
  return isNaN(t) ? null : t;
};
// Appeal info for a row: deadline timestamp + whole days remaining (negative = past).
const appealInfo = (r: Record<string, unknown>): { deadline: number; daysLeft: number; window: number } | null => {
  const window = appealWindowDays(r);
  const paid = parseDay(r.payment_date);
  if (window == null || paid == null) return null;
  const deadline = paid + window * 86_400_000;
  const daysLeft = Math.ceil((deadline - Date.now()) / 86_400_000);
  return { deadline, daysLeft, window };
};
const fmtDay = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
// "Appeal window closing" = still open but ≤ 30 days left.
const appealClosingSoon = (r: Record<string, unknown>) => {
  const info = appealInfo(r);
  return !!info && info.daysLeft >= 0 && info.daysLeft <= 30;
};
const appealPastDue = (r: Record<string, unknown>) => {
  const info = appealInfo(r);
  return !!info && info.daysLeft < 0;
};

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
  let appealSoon = 0;
  let appealPast = 0;
  for (const r of rows) {
    charge += num(r.charge_amount);
    if (isApproved(r)) collected += num(r.amt_allowed) + num(r.additional_payment);
    addl += num(r.additional_payment);
    if (isLate(r)) lateCount += 1;
    if (appealClosingSoon(r)) appealSoon += 1;
    if (appealPastDue(r)) appealPast += 1;
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
        <SumCard
          label="Appeal ≤30d"
          value={String(appealSoon)}
          accent={appealSoon > 0 ? "gold" : "recovered"}
        />
        <SumCard
          label="Appeal PAST DUE"
          value={String(appealPast)}
          accent={appealPast > 0 ? "risk" : "recovered"}
        />
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
  {
    key: "queue_level",
    label: "Queue Level",
    kind: "text",
    min: "min-w-[8rem]",
    compute: (r) => queueLevelLabel(r),
  },
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
  // Date the payer paid — the appeal clock starts here.
  { key: "payment_date", label: "Payment Date", kind: "text", editable: true, min: "min-w-[9rem]" },
  // Appeal deadline = payment date + payer window (Cigna 90d, Aetna/GCS 180d).
  {
    key: "appeal_deadline",
    label: "Appeal Deadline",
    kind: "text",
    min: "min-w-[12rem]",
    compute: (r) => {
      const window = appealWindowDays(r);
      if (window == null) return "—"; // payer has no tracked window
      const info = appealInfo(r);
      if (!info) return "⤷ set Payment Date";
      const d = fmtDay(info.deadline);
      if (info.daysLeft < 0) return `⛔ PAST DUE · ${d} (${-info.daysLeft}d ago)`;
      if (info.daysLeft === 0) return `⛔ DUE TODAY · ${d}`;
      if (info.daysLeft <= 30) return `⚠ ${d} · ${info.daysLeft}d left`;
      return `${d} · ${info.daysLeft}d left`;
    },
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
    { value: "appeal_soon", label: "Appeal window ≤30 days", test: appealClosingSoon },
    { value: "appeal_past", label: "Appeal PAST DUE", test: appealPastDue },
  ],
};

const config: TrackerConfig = {
  table: "repricing",
  // Work order: payer priority (BCBS always last), then most-overdue first.
  sortCompare: (a, b) => {
    const ra = payerRank(a);
    const rb = payerRank(b);
    if (ra !== rb) return ra - rb;
    return daysUntouched(b) - daysUntouched(a);
  },
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
    // Clicking a payer opens its "how to handle these claims" directions.
    playbookTable: "payer_playbooks",
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
    "payment_date",
  ],
  // The payment date arrives on uploads, but a blank cell must never erase a
  // date already captured on a prior import.
  importSkipBlankKeys: ["payment_date"],
  columns,
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
