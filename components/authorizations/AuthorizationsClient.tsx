"use client";

import TrackerModule, { type TrackerConfig } from "@/components/trackers/TrackerModule";
import { parseAuthorizations } from "@/lib/import/parseTrackers";
import {
  AUTH_STATUS_OPTIONS,
  LEVEL_OF_CARE_OPTIONS,
  type Facility,
} from "@/lib/types";

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
