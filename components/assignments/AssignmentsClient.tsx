"use client";

import TrackerModule, { type TrackerConfig } from "@/components/trackers/TrackerModule";
import { parseAssignments } from "@/lib/import/parseTrackers";
import type { Facility } from "@/lib/types";

const config: TrackerConfig = {
  table: "weekly_assignments",
  searchKeys: [
    "week",
    "collectors",
    "billers",
    "ur_specialist",
    "repricing_specialist",
    "pricing_specialist",
  ],
  parse: (buf) => parseAssignments(buf),
  columns: [
    { key: "week", label: "Week", kind: "text", editable: true, min: "min-w-[8rem]" },
    { key: "collectors", label: "Collectors", kind: "text", editable: true, min: "min-w-[14rem]" },
    { key: "billers", label: "Billers", kind: "text", editable: true, min: "min-w-[12rem]" },
    { key: "ur_specialist", label: "UR Specialist", kind: "text", editable: true, min: "min-w-[12rem]" },
    { key: "repricing_specialist", label: "Repricing Specialist", kind: "text", editable: true, min: "min-w-[12rem]" },
    { key: "pricing_specialist", label: "Pricing Specialist", kind: "text", editable: true, min: "min-w-[12rem]" },
    { key: "notes", label: "Notes", kind: "notes", editable: true },
  ],
};

export default function AssignmentsClient({
  facilities,
  userId,
  isManagement,
}: {
  facilities: Facility[];
  userId: string;
  isManagement: boolean;
}) {
  return (
    <TrackerModule
      facilities={facilities}
      userId={userId}
      config={config}
      isManagement={isManagement}
    />
  );
}
