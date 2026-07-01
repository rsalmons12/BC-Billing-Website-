"use client";

import TrackerModule, {
  type TrackerConfig,
  SumCard,
} from "@/components/trackers/TrackerModule";
import { parseAuthorizations } from "@/lib/import/parseTrackers";
import {
  AUTH_STATUS_OPTIONS,
  LEVEL_OF_CARE_OPTIONS,
  type Facility,
} from "@/lib/types";

// Parse a stored review date ("M/D/YYYY" or similar) to a Date at local
// midnight, or null if it isn't a real date.
function parseReviewDate(v: unknown): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const t = Date.parse(s);
  if (isNaN(t)) return null;
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d;
}

// A claim is up for its Next Review once today lands on the Next Review date
// or later (e.g. review date 4/22 counts from 4/22 onward).
function isDueForReview(row: Record<string, unknown>): boolean {
  const d = parseReviewDate(row.next_review_date);
  if (!d) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d.getTime() <= today.getTime();
}

const config: TrackerConfig = {
  table: "authorizations",
  statusKey: "status",
  statusOptions: AUTH_STATUS_OPTIONS,
  searchKeys: ["patient_name", "auth_number", "level_of_care", "status"],
  parse: (buf) => parseAuthorizations(buf),
  archiveKey: "discharged",
  archiveLabels: {
    active: "Active",
    archived: "Discharged",
    action: "Discharge",
    unaction: "Reactivate",
  },
  columns: [
    { key: "patient_name", label: "Patient", kind: "text", editable: true, min: "min-w-[11rem]" },
    { key: "admit_date", label: "Admit", kind: "text", editable: true },
    { key: "start_date", label: "Start", kind: "text", editable: true },
    { key: "end_date", label: "End", kind: "text", editable: true },
    { key: "discharge_date", label: "Discharge", kind: "text", editable: true },
    { key: "next_review_date", label: "Next Review", kind: "text", editable: true, min: "min-w-[9rem]" },
    { key: "auth_number", label: "Auth #", kind: "text", editable: true, min: "min-w-[9rem]" },
    { key: "level_of_care", label: "LOC", kind: "select", options: LEVEL_OF_CARE_OPTIONS, editable: true, min: "min-w-[6rem]" },
    { key: "status", label: "Status", kind: "select", options: AUTH_STATUS_OPTIONS, editable: true, min: "min-w-[8rem]" },
    { key: "notes", label: "Notes", kind: "notes", editable: true },
  ],
  extraFilters: {
    label: "All reviews",
    options: [{ value: "due", label: "Next Review due", test: isDueForReview }],
  },
  renderSummary: (rows) => {
    const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
    const approved = rows.filter((r) => /approv/.test(norm(r.status))).length;
    const pending = rows.filter((r) => /pending/.test(norm(r.status))).length;
    // "Next Review": rows whose Next Review date is today or earlier.
    const nextReview = rows.filter(isDueForReview).length;
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SumCard label="Authorizations" value={String(rows.length)} />
        <SumCard label="Next Review" value={String(nextReview)} accent="risk" />
        <SumCard label="Approved" value={String(approved)} accent="recovered" />
        <SumCard label="Pending" value={String(pending)} accent="gold" />
      </div>
    );
  },
};

export default function AuthorizationsClient({
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
