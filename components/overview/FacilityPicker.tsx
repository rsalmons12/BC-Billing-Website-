"use client";

import { useRouter, useSearchParams } from "next/navigation";

// Scopes the dashboard to one facility (or all). Navigates with ?facility=.
export default function FacilityPicker({
  facilities,
  value,
}: {
  facilities: { id: string; label: string }[];
  value: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  if (facilities.length <= 1) return null; // a single-facility login has nothing to pick

  return (
    <select
      value={value}
      onChange={(e) => {
        const p = new URLSearchParams(params.toString());
        if (e.target.value === "all") p.delete("facility");
        else p.set("facility", e.target.value);
        router.push(`/overview${p.toString() ? `?${p.toString()}` : ""}`);
      }}
      className="rounded-lg border border-surface-border bg-surface-card px-3 py-1.5 text-sm text-surface-ink"
    >
      <option value="all">All facilities</option>
      {facilities.map((f) => (
        <option key={f.id} value={f.id}>
          {f.label}
        </option>
      ))}
    </select>
  );
}
