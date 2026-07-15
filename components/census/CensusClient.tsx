"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import { SumCard } from "@/components/trackers/TrackerModule";
import { parseCensus, tallySessions, CENSUS_SESSION_CODES } from "@/lib/import/parseCensus";
import { CENSUS_BILLING_STATUS, type Census, type Facility } from "@/lib/types";

const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

function weekLabelFrom(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const start = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const f = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  return `${f(start)}–${f(end)}`;
}

function dayHeader(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${d.toLocaleDateString("en-US", { weekday: "short" })} ${d.getMonth() + 1}/${d.getDate()}`;
}

export default function CensusClient({
  facilities,
  userId,
  canBill,
}: {
  facilities: Facility[];
  userId: string;
  canBill: boolean; // management/staff may set billing status
}) {
  const supabase = useMemo(() => createClient(), []);
  const [facilityId, setFacilityId] = useState(facilities[0]?.id ?? "");
  const [rows, setRows] = useState<Census[]>([]);
  const [week, setWeek] = useState("");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const facName = useMemo(() => {
    const f = facilities.find((x) => x.id === facilityId);
    return f?.short_name || f?.name || "Facility";
  }, [facilities, facilityId]);

  const load = useCallback(async () => {
    if (!facilityId) return;
    setLoading(true);
    const data = await selectAll<Census>((f, t) =>
      supabase
        .from("census")
        .select("*")
        .eq("facility_id", facilityId)
        .order("week_start", { ascending: false })
        .range(f, t)
    ).catch(() => [] as Census[]);
    setRows(data);
    setLoading(false);
  }, [supabase, facilityId]);

  useEffect(() => {
    load();
  }, [load]);

  // Weeks present for this facility (newest first).
  const weeks = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.week_start) s.add(r.week_start);
    return Array.from(s).sort().reverse();
  }, [rows]);

  useEffect(() => {
    if (weeks.length && !weeks.includes(week)) setWeek(weeks[0]);
  }, [weeks, week]);

  const weekRows = useMemo(
    () => rows.filter((r) => r.week_start === week),
    [rows, week]
  );

  // Day columns for the selected week (union of day keys across its rows).
  const dayCols = useMemo(() => {
    const s = new Set<string>();
    for (const r of weekRows) for (const k of Object.keys(r.days ?? {})) s.add(k);
    return Array.from(s).sort();
  }, [weekRows]);

  const tally = useMemo(
    () => tallySessions(weekRows.map((r) => ({ days: r.days ?? {} }))),
    [weekRows]
  );

  const save = useCallback(
    async (id: string, partial: Partial<Census>) => {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...partial } : r)));
      setMsg("Saving…");
      const { error } = await supabase
        .from("census")
        .update({ ...partial, updated_by: userId, updated_at: new Date().toISOString() })
        .eq("id", id);
      setMsg(error ? `Error: ${error.message}` : "Saved");
      if (!error) setTimeout(() => setMsg(""), 900);
    },
    [supabase, userId]
  );

  const setDay = (r: Census, iso: string, code: string) => {
    const days = { ...(r.days ?? {}) };
    if (code.trim()) days[iso] = code.trim();
    else delete days[iso];
    save(r.id, { days });
  };

  const doImport = async (file: File) => {
    if (!facilityId) return;
    setMsg("Reading census…");
    let parsed;
    try {
      parsed = parseCensus(await file.arrayBuffer());
    } catch (e) {
      setMsg(`Couldn't read that file: ${e instanceof Error ? e.message : "unknown"}`);
      return;
    }
    if (parsed.rows.length === 0) {
      setMsg("No census rows found in that workbook.");
      return;
    }
    const importedWeeks = Array.from(new Set(parsed.rows.map((r) => r.week_start)));
    if (
      !confirm(
        `Import ${parsed.rows.length} patient-weeks across ${importedWeeks.length} week(s) ` +
          `for ${facName}?\n\nThis replaces those week(s) for this facility; other weeks stay as they are.`
      )
    ) {
      setMsg("Import cancelled.");
      return;
    }
    // Replace just the weeks present in the file for this facility.
    const { error: delErr } = await supabase
      .from("census")
      .delete()
      .eq("facility_id", facilityId)
      .in("week_start", importedWeeks);
    if (delErr) {
      setMsg(`Error clearing weeks: ${delErr.message}`);
      return;
    }
    const payload = parsed.rows.map((r) => ({
      facility_id: facilityId,
      week_start: r.week_start,
      week_label: r.week_label,
      level_of_care: r.level_of_care,
      patient_name: r.patient_name,
      admit_date: r.admit_date,
      insurance: r.insurance,
      member_id: r.member_id,
      auth: r.auth,
      comments: r.comments,
      step_up: r.step_up,
      repriced: r.repriced,
      days: r.days,
      updated_by: userId,
    }));
    let inserted = 0;
    for (const batch of chunk(payload, 300)) {
      const { error } = await supabase.from("census").insert(batch);
      if (error) {
        setMsg(`Error importing: ${error.message}`);
        return;
      }
      inserted += batch.length;
    }
    setMsg(`✓ Imported ${inserted} rows across ${importedWeeks.length} week(s).`);
    setWeek(importedWeeks.sort().reverse()[0]);
    load();
  };

  return (
    <div className="flex h-full flex-col">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-surface-border bg-surface-card px-6 py-3">
        <select
          value={facilityId}
          onChange={(e) => setFacilityId(e.target.value)}
          className="input max-w-[16rem]"
        >
          {facilities.length === 0 && <option value="">No facilities</option>}
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>
              {f.short_name || f.name}
            </option>
          ))}
        </select>

        <select
          value={week}
          onChange={(e) => setWeek(e.target.value)}
          className="input max-w-[12rem]"
          disabled={loading || weeks.length === 0}
        >
          {weeks.length === 0 && <option value="">No weeks yet</option>}
          {weeks.map((w) => (
            <option key={w} value={w}>
              Week of {weekLabelFrom(w)}
            </option>
          ))}
        </select>

        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) doImport(f);
            e.target.value = "";
          }}
        />
        <button onClick={() => fileRef.current?.click()} className="btn-gold" disabled={!facilityId}>
          ↥ Import weekly census
        </button>

        <div className="ml-auto flex items-center gap-3 text-xs">
          {msg && <span className="font-medium text-secured">{msg}</span>}
          <span className="text-surface-muted">
            <b className="text-surface-ink">{weekRows.length}</b> clients
          </span>
        </div>
      </div>

      {/* weekly tallies */}
      {!loading && week && (
        <div className="grid grid-cols-3 gap-3 border-b border-surface-border bg-surface px-6 py-3 md:grid-cols-7">
          <SumCard label="Total Clients" value={String(weekRows.length)} accent="secured" />
          {CENSUS_SESSION_CODES.map((c) => (
            <SumCard key={c} label={`${c} Sessions`} value={String(tally[c] ?? 0)} />
          ))}
        </div>
      )}

      {/* grid */}
      <div className="scroll-x min-h-0 flex-1 overflow-auto">
        {loading ? (
          <p className="p-8 text-center text-sm text-surface-muted">Loading census…</p>
        ) : weeks.length === 0 ? (
          <p className="p-8 text-center text-sm text-surface-muted">
            No census yet for {facName}. Click “↥ Import weekly census” to add this week’s grid.
          </p>
        ) : (
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr>
                <th className="th">LOC</th>
                <th className="th sticky left-0 bg-surface">Name</th>
                <th className="th">Admit</th>
                <th className="th">Insurance</th>
                <th className="th">Member ID</th>
                <th className="th">Auth</th>
                {dayCols.map((d) => (
                  <th key={d} className="th whitespace-nowrap text-center">
                    {dayHeader(d)}
                  </th>
                ))}
                <th className="th min-w-[11rem]">Billing Status</th>
                <th className="th min-w-[12rem]">Comments</th>
              </tr>
            </thead>
            <tbody>
              {weekRows.length === 0 && (
                <tr>
                  <td colSpan={8 + dayCols.length} className="td py-8 text-center text-surface-muted">
                    No clients for this week.
                  </td>
                </tr>
              )}
              {weekRows.map((r, i) => (
                <tr key={r.id} className={i % 2 ? "bg-surface/40" : "bg-surface-card"}>
                  <td className="td whitespace-nowrap text-xs">{r.level_of_care || "—"}</td>
                  <td className="td sticky left-0 bg-inherit font-medium">{r.patient_name || "—"}</td>
                  <td className="td text-xs text-surface-muted">{r.admit_date || "—"}</td>
                  <td className="td text-xs">{r.insurance || "—"}</td>
                  <td className="td font-mono text-xs">{r.member_id || "—"}</td>
                  <td className="td text-xs">{r.auth || "—"}</td>
                  {dayCols.map((d) => (
                    <td key={d} className="td p-0.5">
                      <input
                        defaultValue={r.days?.[d] ?? ""}
                        onBlur={(e) => {
                          if ((e.target.value ?? "") !== (r.days?.[d] ?? ""))
                            setDay(r, d, e.target.value);
                        }}
                        className="cell-input w-20 text-center text-xs"
                      />
                    </td>
                  ))}
                  <td className="td">
                    <select
                      value={r.billing_status ?? ""}
                      disabled={!canBill}
                      onChange={(e) => save(r.id, { billing_status: e.target.value })}
                      className={`cell-input ${
                        !String(r.billing_status ?? "").trim()
                          ? "font-semibold text-risk ring-1 ring-risk/40"
                          : ""
                      } ${!canBill ? "opacity-70" : ""}`}
                    >
                      {CENSUS_BILLING_STATUS.map((s) => (
                        <option key={s} value={s}>
                          {s || "— No status —"}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="td p-0.5">
                    <input
                      defaultValue={r.comments ?? ""}
                      onBlur={(e) => {
                        if ((e.target.value ?? "") !== (r.comments ?? ""))
                          save(r.id, { comments: e.target.value });
                      }}
                      className="cell-input min-w-[11rem] text-xs"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
