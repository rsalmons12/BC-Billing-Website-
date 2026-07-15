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

// A cell input that saves on blur only when the value actually changed. Keyed
// by its incoming value so an external refresh (import/reload) reflows it.
function EditText({
  value,
  onSave,
  className = "",
}: {
  value: string;
  onSave: (v: string) => void;
  className?: string;
}) {
  return (
    <input
      key={value}
      defaultValue={value}
      onBlur={(e) => {
        if (e.target.value !== value) onSave(e.target.value);
      }}
      className={`cell-input ${className}`}
    />
  );
}

// Weekly rules from the census Summary sheet (per client, per week).
const WEEKLY_RULES: Record<string, number> = { CM: 2, PF: 1, ID: 1 };
const REQ_CODES = ["GN", "CM", "PF", "ID"] as const;

// Program days per week from the level of care (IOP 3 -> 3, IOP CO 5 -> 5 …).
// GN (group note) is expected once per program day.
function locProgramDays(loc: string | null): number {
  const m = String(loc ?? "").match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

function requirementsFor(loc: string | null): Record<string, number> {
  return { GN: locProgramDays(loc), CM: WEEKLY_RULES.CM, PF: WEEKLY_RULES.PF, ID: WEEKLY_RULES.ID };
}

// Count each service code across a patient's day cells.
function actualsFor(days: Record<string, string> | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const code of Object.values(days ?? {})) {
    for (const part of String(code).split(/[/,]/)) {
      const k = part.trim().toUpperCase();
      if (k) out[k] = (out[k] ?? 0) + 1;
    }
  }
  return out;
}

function addDaysIso(iso: string, n: number): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

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

  // Day columns for the selected week (union of day keys across its rows). A
  // fresh, hand-keyed week with no codes yet still shows 7 day columns derived
  // from the week start, so there's a grid to type into.
  const dayCols = useMemo(() => {
    const s = new Set<string>();
    for (const r of weekRows) for (const k of Object.keys(r.days ?? {})) s.add(k);
    if (s.size === 0 && week) for (let i = 0; i < 7; i++) s.add(addDaysIso(week, i));
    return Array.from(s).sort();
  }, [weekRows, week]);

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
    // Keep the key even when blank so a hand-keyed week never loses its columns.
    const days = { ...(r.days ?? {}), [iso]: code.trim() };
    save(r.id, { days });
  };

  // Insert a blank patient row into a week, seeded with that week's 7 day
  // columns (empty) so there's a full grid to type into.
  const addPatientRow = useCallback(
    async (weekStart: string) => {
      if (!facilityId || !weekStart) return;
      const days: Record<string, string> = {};
      for (let i = 0; i < 7; i++) days[addDaysIso(weekStart, i)] = "";
      setMsg("Adding patient…");
      const { data, error } = await supabase
        .from("census")
        .insert({
          facility_id: facilityId,
          week_start: weekStart,
          week_label: weekLabelFrom(weekStart),
          days,
          billing_status: "",
          updated_by: userId,
        })
        .select()
        .single();
      if (error) {
        setMsg(`Error: ${error.message}`);
        return;
      }
      setRows((prev) => [...prev, data as Census]);
      setMsg("Patient added");
      setTimeout(() => setMsg(""), 900);
    },
    [supabase, facilityId, userId]
  );

  // Start a brand-new week (from its Monday) and drop in the first blank row.
  const [newWeek, setNewWeek] = useState("");
  const addWeek = async () => {
    if (!newWeek) {
      setMsg("Pick a week-start date first.");
      return;
    }
    await addPatientRow(newWeek);
    setWeek(newWeek);
    setNewWeek("");
  };

  const deleteRow = async (id: string) => {
    if (!confirm("Remove this client from the census? (Use this when a patient is discharged.)"))
      return;
    setRows((prev) => prev.filter((r) => r.id !== id));
    await supabase.from("census").delete().eq("id", id);
  };

  // Carry this week's roster into the following week — same clients + details,
  // blank daily codes to fill in. Discharged patients are just removed (✕).
  const copyToNextWeek = async () => {
    if (!week || weekRows.length === 0) return;
    const next = addDaysIso(week, 7);
    const existing = rows.some((r) => r.week_start === next);
    if (
      !confirm(
        `Copy ${weekRows.length} clients into the week of ${weekLabelFrom(next)}?` +
          (existing ? "\n\nThat week already has clients — these will be added to it." : "") +
          "\n\nPatient details carry over; daily codes start blank."
      )
    )
      return;
    setMsg("Copying to next week…");
    const seed = () => {
      const d: Record<string, string> = {};
      for (let i = 0; i < 7; i++) d[addDaysIso(next, i)] = "";
      return d;
    };
    const payload = weekRows.map((r) => ({
      facility_id: facilityId,
      week_start: next,
      week_label: weekLabelFrom(next),
      level_of_care: r.level_of_care,
      patient_name: r.patient_name,
      admit_date: r.admit_date,
      insurance: r.insurance,
      member_id: r.member_id,
      auth: r.auth,
      step_up: r.step_up,
      repriced: r.repriced,
      comments: "",
      billing_status: "",
      days: seed(),
      updated_by: userId,
    }));
    for (const batch of chunk(payload, 300)) {
      const { error } = await supabase.from("census").insert(batch);
      if (error) {
        setMsg(`Error copying: ${error.message}`);
        return;
      }
    }
    setMsg(`✓ Copied to week of ${weekLabelFrom(next)}.`);
    await load();
    setWeek(next);
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

        {week && (
          <button
            onClick={() => addPatientRow(week)}
            className="btn-ghost"
            disabled={!facilityId}
            title="Add a blank client row to this week"
          >
            + Add patient
          </button>
        )}

        {week && weekRows.length > 0 && (
          <button
            onClick={copyToNextWeek}
            className="btn-ghost"
            title="Copy this week's clients into next week (blank daily codes)"
          >
            ⧉ Copy to next week
          </button>
        )}

        <div className="flex items-center gap-1 rounded-lg border border-surface-border px-2 py-1">
          <span className="text-[11px] text-surface-muted">New week</span>
          <input
            type="date"
            value={newWeek}
            onChange={(e) => setNewWeek(e.target.value)}
            className="input py-1 text-xs"
            title="Week start (Monday)"
          />
          <button
            onClick={addWeek}
            className="badge bg-command px-2 py-1 text-[11px] font-semibold text-command-text"
            disabled={!facilityId || !newWeek}
          >
            + Start
          </button>
        </div>

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
            No census yet for {facName}. Import a workbook with “↥ Import weekly census”, or pick a
            “New week” date above and hit “+ Start” to key it in by hand.
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
                <th className="th">Step-Up</th>
                <th className="th">Repriced</th>
                {dayCols.map((d) => (
                  <th key={d} className="th whitespace-nowrap text-center">
                    {dayHeader(d)}
                  </th>
                ))}
                <th className="th text-center" title="Required sessions from level of care">
                  Expected
                </th>
                <th className="th text-center" title="Required sessions still missing this week">
                  Missed
                </th>
                <th className="th min-w-[11rem]">Billing Status</th>
                <th className="th min-w-[12rem]">Comments</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {weekRows.length === 0 && (
                <tr>
                  <td colSpan={13 + dayCols.length} className="td py-8 text-center text-surface-muted">
                    No clients yet for this week.{" "}
                    <button
                      onClick={() => addPatientRow(week)}
                      className="font-semibold text-command hover:underline"
                    >
                      + Add the first patient
                    </button>
                  </td>
                </tr>
              )}
              {weekRows.map((r, i) => {
                const req = requirementsFor(r.level_of_care);
                const act = actualsFor(r.days);
                const missed = REQ_CODES.map((c) => ({
                  c,
                  short: Math.max(0, req[c] - (act[c] ?? 0)),
                })).filter((m) => m.short > 0);
                return (
                <tr key={r.id} className={i % 2 ? "bg-surface/40" : "bg-surface-card"}>
                  <td className="td p-0.5">
                    <EditText
                      value={r.level_of_care ?? ""}
                      onSave={(v) => save(r.id, { level_of_care: v })}
                      className="w-20 text-xs"
                    />
                  </td>
                  <td className="td sticky left-0 bg-inherit p-0.5">
                    <EditText
                      value={r.patient_name ?? ""}
                      onSave={(v) => save(r.id, { patient_name: v })}
                      className="min-w-[9rem] font-medium"
                    />
                  </td>
                  <td className="td p-0.5">
                    <EditText
                      value={r.admit_date ?? ""}
                      onSave={(v) => save(r.id, { admit_date: v })}
                      className="w-24 text-xs"
                    />
                  </td>
                  <td className="td p-0.5">
                    <EditText
                      value={r.insurance ?? ""}
                      onSave={(v) => save(r.id, { insurance: v })}
                      className="w-28 text-xs"
                    />
                  </td>
                  <td className="td p-0.5">
                    <EditText
                      value={r.member_id ?? ""}
                      onSave={(v) => save(r.id, { member_id: v })}
                      className="w-28 font-mono text-xs"
                    />
                  </td>
                  <td className="td p-0.5">
                    <EditText
                      value={r.auth ?? ""}
                      onSave={(v) => save(r.id, { auth: v })}
                      className="w-24 text-xs"
                    />
                  </td>
                  <td className="td p-0.5">
                    <EditText
                      value={r.step_up ?? ""}
                      onSave={(v) => save(r.id, { step_up: v })}
                      className="w-20 text-xs"
                    />
                  </td>
                  <td className="td p-0.5">
                    <EditText
                      value={r.repriced ?? ""}
                      onSave={(v) => save(r.id, { repriced: v })}
                      className="w-20 text-xs"
                    />
                  </td>
                  {dayCols.map((d) => (
                    <td key={d} className="td p-0.5">
                      <EditText
                        value={r.days?.[d] ?? ""}
                        onSave={(v) => setDay(r, d, v)}
                        className="w-20 text-center text-xs"
                      />
                    </td>
                  ))}
                  <td className="td whitespace-nowrap text-center text-[11px] text-surface-muted">
                    {REQ_CODES.filter((c) => req[c] > 0)
                      .map((c) => `${c}${req[c]}`)
                      .join(" ") || "—"}
                  </td>
                  <td
                    className={`td whitespace-nowrap text-center text-[11px] font-semibold ${
                      missed.length ? "text-risk" : "text-recovered"
                    }`}
                    title="Required sessions still short this week"
                  >
                    {missed.length
                      ? missed.map((m) => `${m.c} −${m.short}`).join(", ")
                      : "✓"}
                  </td>
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
                    <EditText
                      value={r.comments ?? ""}
                      onSave={(v) => save(r.id, { comments: v })}
                      className="min-w-[11rem] text-xs"
                    />
                  </td>
                  <td className="td text-center">
                    <button
                      onClick={() => deleteRow(r.id)}
                      className="text-surface-muted hover:text-risk"
                      title="Remove client (discharged)"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
