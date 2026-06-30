"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import { money } from "@/lib/format";
import type { Facility, ClaimAdjustment } from "@/lib/types";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
    dt.getDate()
  ).padStart(2, "0")}`;
}

export default function AdjustmentsClient({
  facilities,
  isManagement,
}: {
  facilities: Facility[];
  isManagement: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const today = todayStr();
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const [facilityFilter, setFacilityFilter] = useState("all");
  const [rows, setRows] = useState<ClaimAdjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const facName = useCallback(
    (id: string | null) =>
      facilities.find((f) => f.id === id)?.short_name ||
      facilities.find((f) => f.id === id)?.name ||
      "—",
    [facilities]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await selectAll<ClaimAdjustment>((f, t) =>
        supabase
          .from("claim_adjustments")
          .select("*")
          .order("created_at", { ascending: false })
          .range(f, t)
      );
      setRows(data);
    } catch {
      setRows([]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const d = (r.created_at || "").slice(0, 10);
      if (d < from || d > to) return false;
      if (facilityFilter !== "all" && r.facility_id !== facilityFilter) return false;
      return true;
    });
  }, [rows, from, to, facilityFilter]);

  const preset = (k: "today" | "week" | "month") => {
    if (k === "today") {
      setFrom(today);
      setTo(today);
    } else if (k === "week") {
      setFrom(addDays(today, -6));
      setTo(today);
    } else {
      setFrom(today.slice(0, 8) + "01");
      setTo(today);
    }
  };

  const remove = async (r: ClaimAdjustment) => {
    if (!confirm(`Remove ${r.patient_name ?? r.claim_id} from Adjustments?`)) return;
    setRows((prev) => prev.filter((x) => x.id !== r.id));
    const { error } = await supabase.from("claim_adjustments").delete().eq("id", r.id);
    setMsg(error ? `Error: ${error.message}` : "Removed");
    if (!error) setTimeout(() => setMsg(""), 1200);
  };

  const exportXlsx = () => {
    const data = filtered.map((r) => ({
      Date: (r.created_at || "").slice(0, 10),
      Patient: r.patient_name ?? "",
      "Claim ID": r.claim_id ?? "",
      Facility: facName(r.facility_id),
      "Member ID": r.member_id ?? "",
      DOB: r.dob ?? "",
      "DOS From": r.dos_from ?? "",
      "DOS To": r.dos_to ?? "",
      Charge: r.charge_amount ?? 0,
      Balance: r.balance ?? 0,
      Status: r.claim_status ?? "",
      Reason: r.reason ?? "",
      By: r.initials ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Adjustments");
    XLSX.writeFile(wb, `adjustments_${from}_to_${to}.xlsx`);
  };

  return (
    <div className="flex h-full flex-col">
      {/* toolbar */}
      <div className="flex flex-wrap items-end gap-3 border-b border-surface-border bg-surface-card px-6 py-3">
        <div>
          <span className="label">From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input" />
        </div>
        <div>
          <span className="label">To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input" />
        </div>
        <div className="flex gap-1">
          {(
            [
              ["today", "Today"],
              ["week", "This week"],
              ["month", "This month"],
            ] as [Parameters<typeof preset>[0], string][]
          ).map(([k, lbl]) => (
            <button
              key={k}
              onClick={() => preset(k)}
              className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-xs font-semibold text-surface-muted hover:bg-surface-card"
            >
              {lbl}
            </button>
          ))}
        </div>
        <div>
          <span className="label">Facility</span>
          <select
            value={facilityFilter}
            onChange={(e) => setFacilityFilter(e.target.value)}
            className="input min-w-[12rem]"
          >
            <option value="all">All facilities</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.short_name || f.name}
              </option>
            ))}
          </select>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {msg && <span className="text-xs font-medium text-secured">{msg}</span>}
          <span className="text-xs text-surface-muted">
            <b className="text-surface-ink">{filtered.length}</b> flagged
          </span>
          <button onClick={exportXlsx} disabled={filtered.length === 0} className="btn-gold disabled:opacity-50">
            ↓ Export
          </button>
        </div>
      </div>

      {/* table */}
      <div className="scroll-x min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              <th className="th">Date</th>
              <th className="th">Patient</th>
              <th className="th">Claim ID</th>
              <th className="th">Facility</th>
              <th className="th">DOB</th>
              <th className="th">DOS</th>
              <th className="th text-right">Balance</th>
              <th className="th">Status</th>
              <th className="th min-w-[18rem]">Reason</th>
              <th className="th">By</th>
              {isManagement && <th className="th"></th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={isManagement ? 11 : 10} className="td py-10 text-center text-surface-muted">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={isManagement ? 11 : 10} className="td py-10 text-center text-surface-muted">
                  No adjustments in this range. Collectors flag claims from the Queue with “✎ Adjust.”
                </td>
              </tr>
            )}
            {!loading &&
              filtered.map((r, i) => (
                <tr key={r.id} className={i % 2 ? "bg-surface/40" : "bg-surface-card"}>
                  <td className="td whitespace-nowrap text-xs">{(r.created_at || "").slice(0, 10)}</td>
                  <td className="td font-medium">{r.patient_name || "—"}</td>
                  <td className="td font-mono text-xs">{r.claim_id || "—"}</td>
                  <td className="td text-xs text-surface-muted">{facName(r.facility_id)}</td>
                  <td className="td text-xs text-surface-muted">{r.dob || "—"}</td>
                  <td className="td text-xs text-surface-muted">
                    {r.dos_from || "—"}
                    {r.dos_to ? `–${r.dos_to}` : ""}
                  </td>
                  <td className="td text-right font-mono">{money(r.balance)}</td>
                  <td className="td text-xs">{r.claim_status || "—"}</td>
                  <td className="td whitespace-pre-wrap">{r.reason || "—"}</td>
                  <td className="td text-xs uppercase">{r.initials || "—"}</td>
                  {isManagement && (
                    <td className="td text-right">
                      <button
                        onClick={() => remove(r)}
                        className="text-xs font-semibold text-risk hover:underline"
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
