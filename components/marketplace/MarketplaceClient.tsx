"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import { money } from "@/lib/format";
import type { Facility, MarketplaceClaim } from "@/lib/types";

export default function MarketplaceClient({
  facilities,
  isManagement,
}: {
  facilities: Facility[];
  isManagement: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [facilityFilter, setFacilityFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<MarketplaceClaim[]>([]);
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
      const data = await selectAll<MarketplaceClaim>((f, t) =>
        supabase
          .from("marketplace_claims")
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
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (facilityFilter !== "all" && r.facility_id !== facilityFilter) return false;
      if (q) {
        const hay = `${r.patient_name ?? ""} ${r.claim_id ?? ""} ${r.member_id ?? ""} ${
          r.claim_status ?? ""
        }`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, facilityFilter, search]);

  const totalBalance = filtered.reduce((s, r) => s + (r.balance ?? 0), 0);

  // Shift a claim back to the regular queue (management only).
  const restore = async (r: MarketplaceClaim) => {
    if (!confirm(`Return ${r.patient_name ?? r.claim_id} to the queue?`)) return;
    setRows((prev) => prev.filter((x) => x.id !== r.id));
    const { error } = await supabase.from("marketplace_claims").delete().eq("id", r.id);
    setMsg(error ? `Error: ${error.message}` : "Returned to queue");
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
      DOS: `${r.dos_from ?? ""}${r.dos_to ? `–${r.dos_to}` : ""}`,
      Balance: r.balance ?? 0,
      Status: r.claim_status ?? "",
      By: r.initials ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Marketplace");
    XLSX.writeFile(wb, `marketplace_exchange.xlsx`);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-surface-border bg-surface-card px-6 py-3">
        <select
          value={facilityFilter}
          onChange={(e) => setFacilityFilter(e.target.value)}
          className="input max-w-[14rem]"
        >
          <option value="all">All facilities</option>
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>
              {f.short_name || f.name}
            </option>
          ))}
        </select>
        <input
          placeholder="Search patient / claim ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input max-w-[18rem] flex-1"
        />
        <div className="ml-auto flex items-center gap-3 text-xs">
          {msg && <span className="font-medium text-secured">{msg}</span>}
          <span className="text-surface-muted">
            <b className="text-surface-ink">{filtered.length}</b> claims ·{" "}
            <b className="text-surface-ink">{money(totalBalance)}</b>
          </span>
          <button onClick={exportXlsx} disabled={filtered.length === 0} className="btn-gold disabled:opacity-50">
            ↓ Export
          </button>
        </div>
      </div>

      <div className="scroll-x min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              <th className="th">Date</th>
              <th className="th">Patient</th>
              <th className="th">Claim ID</th>
              <th className="th">Facility</th>
              <th className="th">Member ID</th>
              <th className="th">DOS</th>
              <th className="th text-right">Balance</th>
              <th className="th">Status</th>
              <th className="th">By</th>
              {isManagement && <th className="th"></th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={isManagement ? 10 : 9} className="td py-10 text-center text-surface-muted">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={isManagement ? 10 : 9} className="td py-10 text-center text-surface-muted">
                  No marketplace / exchange claims yet. Collectors shift them here from the Queue with “⇄ Shift.”
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
                  <td className="td text-xs">{r.member_id || "—"}</td>
                  <td className="td text-xs text-surface-muted">
                    {r.dos_from || "—"}
                    {r.dos_to ? `–${r.dos_to}` : ""}
                  </td>
                  <td className="td text-right font-mono">{money(r.balance)}</td>
                  <td className="td text-xs">{r.claim_status || "—"}</td>
                  <td className="td text-xs uppercase">{r.initials || "—"}</td>
                  {isManagement && (
                    <td className="td text-right">
                      <button
                        onClick={() => restore(r)}
                        className="text-xs font-semibold text-command hover:underline"
                      >
                        Return to queue
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
