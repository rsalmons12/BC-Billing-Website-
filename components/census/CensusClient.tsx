"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import { SumCard } from "@/components/trackers/TrackerModule";
import { money } from "@/lib/format";
import { parseCensus, tallySessions, CENSUS_SESSION_CODES } from "@/lib/import/parseCensus";
import {
  CENSUS_BILLING_STATUS,
  CENSUS_LOC_OPTIONS,
  CENSUS_LOC_GN,
  censusLocRate,
  type Census,
  type Facility,
} from "@/lib/types";

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

// Per-day billing color: click a day box to cycle through these.
const DAY_STATUS_CYCLE = ["", "billed", "pending", "scholarship"];
const DAY_STATUS_BG: Record<string, string> = {
  billed: "bg-recovered/25",
  pending: "bg-gold/25",
  scholarship: "bg-risk/25",
};
const DAY_STATUS_LABEL: Record<string, string> = {
  billed: "Billed",
  pending: "Pending",
  scholarship: "Scholarship",
};

// A money cell that saves a number (or null) on blur. An optional placeholder
// can show an auto-derived value when the field is left blank.
function EditMoney({
  value,
  onSave,
  className = "",
  placeholder = "$",
}: {
  value: number | null;
  onSave: (v: number | null) => void;
  className?: string;
  placeholder?: string;
}) {
  return (
    <input
      key={value ?? ""}
      defaultValue={value != null ? String(value) : ""}
      inputMode="decimal"
      placeholder={placeholder}
      onBlur={(e) => {
        const raw = e.target.value.replace(/[$,\s]/g, "").trim();
        const n = raw === "" ? null : parseFloat(raw);
        const next = n == null || isNaN(n) ? null : n;
        if (next !== value) onSave(next);
      }}
      className={`cell-input text-right ${className}`}
    />
  );
}

// Weekly rules from the census Summary sheet (per client, per week). Missed
// sessions are tracked per service — GN, CM, and ID each get their own bucket
// (PF is not counted toward missed).
const WEEKLY_RULES: Record<string, number> = { CM: 2, ID: 1 };
const REQ_CODES = ["GN", "CM", "ID"] as const;

// Per-GN billed rate for a client: a per-row override if set, else the standard
// rate for their level of care (PHP $4,800 / IOP $4,300 per GN).
function rateFor(r: Census): number {
  const override = r.gn_rate;
  if (override != null && override > 0) return override;
  return censusLocRate(r.level_of_care);
}

// Canonical name key for cross-matching census ↔ payments regardless of order
// or punctuation: "James Mccarthy" and "MCCARTHY, JAMES" both → "james mccarthy".
const normName = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");

// A date string → midnight epoch ms (or null).
function dayMs(v: unknown): number | null {
  const t = Date.parse(String(v ?? "").trim());
  if (isNaN(t)) return null;
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Expected reimbursement is 30% of billed. Change here if that differs.
const EXPECTED_PCT = 0.3;

// Expected revenue = per-GN rate × GN sessions delivered × 30% (expected
// reimbursement share of billed).
function expectedFor(r: Census): number {
  return rateFor(r) * (actualsFor(r.days).GN ?? 0) * EXPECTED_PCT;
}

// GN (group note) sessions expected per week for a level of care. Uses the
// mapped value first (PHP, Detox, Residential … have no number), then falls
// back to any number in the name (IOP CO 5 -> 5) for imported/legacy values.
function locProgramDays(loc: string | null): number {
  const key = String(loc ?? "").trim().replace(/\s+/g, " ");
  for (const [name, gn] of Object.entries(CENSUS_LOC_GN)) {
    if (name.toUpperCase() === key.toUpperCase()) return gn;
  }
  const m = key.match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

function requirementsFor(loc: string | null): Record<string, number> {
  return { GN: locProgramDays(loc), CM: WEEKLY_RULES.CM, ID: WEEKLY_RULES.ID };
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
  // Payment lines for this facility (patient + service date + paid $), used to
  // auto-fill each client-week's Paid $ from the Payments section.
  const [payRows, setPayRows] = useState<
    { patient_name: string | null; dos_from: string | null; paid_amount: number | null }[]
  >([]);
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
    const [data, pays] = await Promise.all([
      selectAll<Census>((f, t) =>
        supabase
          .from("census")
          .select("*")
          .eq("facility_id", facilityId)
          .order("week_start", { ascending: false })
          .range(f, t)
      ).catch(() => [] as Census[]),
      // Paid-per-service lines from the Payments section for this facility.
      selectAll<{ patient_name: string | null; dos_from: string | null; paid_amount: number | null }>(
        (f, t) =>
          supabase
            .from("payments")
            .select("patient_name,dos_from,paid_amount")
            .eq("facility_id", facilityId)
            .range(f, t)
      ).catch(() => []),
    ]);
    setRows(data);
    setPayRows(pays);
    setLoading(false);
  }, [supabase, facilityId]);

  // Attribute EVERY payment to exactly one census week per patient, so no
  // payment is dropped just because its service date doesn't fall in a week.
  // A payment lands on the week that contains its service date; if it falls
  // outside all of that patient's weeks (e.g. an old service paid back in May),
  // it lands on that patient's CLOSEST week. One payment → one week, so weekly
  // totals never double-count.
  const paidByPatientWeek = useMemo(() => {
    // patient key → their census week starts (ms), sorted.
    const weeksByPatient = new Map<string, number[]>();
    for (const r of rows) {
      const k = normName(r.patient_name);
      const w = dayMs(r.week_start);
      if (!k || w == null) continue;
      if (!weeksByPatient.has(k)) weeksByPatient.set(k, []);
      const arr = weeksByPatient.get(k)!;
      if (!arr.includes(w)) arr.push(w);
    }
    for (const arr of weeksByPatient.values()) arr.sort((a, b) => a - b);

    const acc = new Map<string, number>(); // `${patient}|${weekMs}` → paid $
    for (const p of payRows) {
      const k = normName(p.patient_name);
      const dos = dayMs(p.dos_from);
      const weeks = weeksByPatient.get(k);
      if (!k || dos == null || !weeks || weeks.length === 0) continue;
      // Week that contains the service date, else the nearest week.
      let target = weeks.find((w) => dos >= w && dos <= w + 6 * 86400000);
      if (target == null) {
        target = weeks.reduce(
          (best, w) => (Math.abs(w - dos) < Math.abs(best - dos) ? w : best),
          weeks[0]
        );
      }
      const key = `${k}|${target}`;
      acc.set(key, (acc.get(key) ?? 0) + (p.paid_amount ?? 0));
    }
    return acc;
  }, [rows, payRows]);

  // Paid $ auto-pulled from Payments for a given client-week.
  const pulledPaid = useCallback(
    (r: Census): number => {
      const w = dayMs(r.week_start);
      if (w == null) return 0;
      return paidByPatientWeek.get(`${normName(r.patient_name)}|${w}`) ?? 0;
    },
    [paidByPatientWeek]
  );

  // Effective Paid $: a manual override wins; otherwise the pulled amount.
  const effectivePaid = useCallback(
    (r: Census): number => {
      if (r.paid_amount != null && r.paid_amount > 0) return r.paid_amount;
      return pulledPaid(r);
    },
    [pulledPaid]
  );

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
    // ALWAYS lay out the full 7-day week from the week start, then union in any
    // actual codes. Without this, a freshly imported/sparsely filled week (e.g.
    // the upcoming week with only one stray code) collapses to a single day
    // column, leaving nowhere to type Tue–Fri or add GN/CM/etc.
    if (week) for (let i = 0; i < 7; i++) s.add(addDaysIso(week, i));
    return Array.from(s).sort();
  }, [weekRows, week]);

  const tally = useMemo(
    () => tallySessions(weekRows.map((r) => ({ days: r.days ?? {} }))),
    [weekRows]
  );

  // Expected $ = the billed weekly rate for each client's level of care; Paid $
  // is entered. Missed sessions are bucketed PER SERVICE (GN / CM / ID each get
  // their own total) rather than lumped into one number.
  const amounts = useMemo(() => {
    let exp = 0;
    let paid = 0;
    const missed: Record<string, number> = {};
    for (const c of REQ_CODES) missed[c] = 0;
    for (const r of weekRows) {
      const act = actualsFor(r.days);
      exp += expectedFor(r);
      paid += effectivePaid(r);
      const req = requirementsFor(r.level_of_care);
      for (const c of REQ_CODES) missed[c] += Math.max(0, req[c] - (act[c] ?? 0));
    }
    return { exp, paid, missed };
  }, [weekRows, effectivePaid]);

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

  // Click a day box to cycle its billing color: none → billed (green) →
  // pending (orange) → scholarship (red) → none.
  const cycleDayStatus = (r: Census, iso: string) => {
    const cur = (r.day_status ?? {})[iso] ?? "";
    const idx = DAY_STATUS_CYCLE.indexOf(cur);
    const next = DAY_STATUS_CYCLE[(idx + 1) % DAY_STATUS_CYCLE.length];
    const day_status = { ...(r.day_status ?? {}) };
    if (next) day_status[iso] = next;
    else delete day_status[iso];
    save(r.id, { day_status });
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
      notes: r.notes,
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
          <div className="flex items-center gap-2 text-[11px] text-surface-muted">
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded-full bg-recovered" /> Billed
            </span>
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded-full bg-gold" /> Pending
            </span>
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded-full bg-risk" /> Scholarship
            </span>
          </div>
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
          {REQ_CODES.map((c) => (
            <SumCard
              key={c}
              label={`Missed ${c}`}
              value={String(amounts.missed[c] ?? 0)}
              accent={(amounts.missed[c] ?? 0) > 0 ? "risk" : "recovered"}
            />
          ))}
          <SumCard label="Expected $" value={money(amounts.exp)} accent="gold" />
          <SumCard label="Paid $" value={money(amounts.paid)} accent="recovered" />
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
                <th
                  className="th text-right"
                  title="Rate per GN override — blank uses the standard LOC rate (PHP $4,800 / IOP $4,300 per GN)"
                >
                  Rate / GN
                </th>
                <th className="th text-right" title="Expected revenue = rate per GN × GN sessions delivered × 30%">
                  Expected $
                </th>
                <th className="th text-right">Paid $</th>
                <th className="th min-w-[11rem]">Billing Status</th>
                <th className="th min-w-[12rem]">Comments</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {weekRows.length === 0 && (
                <tr>
                  <td colSpan={16 + dayCols.length} className="td py-8 text-center text-surface-muted">
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
                    <select
                      value={r.level_of_care ?? ""}
                      onChange={(e) => save(r.id, { level_of_care: e.target.value })}
                      className="cell-input min-w-[6.5rem] text-xs"
                    >
                      {(CENSUS_LOC_OPTIONS.includes(r.level_of_care ?? "")
                        ? CENSUS_LOC_OPTIONS
                        : [r.level_of_care ?? "", ...CENSUS_LOC_OPTIONS]
                      ).map((loc) => (
                        <option key={loc} value={loc}>
                          {loc || "— LOC —"}
                        </option>
                      ))}
                    </select>
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
                  {dayCols.map((d) => {
                    const st = (r.day_status ?? {})[d] ?? "";
                    return (
                      <td key={d} className={`td p-0.5 ${DAY_STATUS_BG[st] ?? ""}`}>
                        <div className="flex items-center gap-0.5">
                          <EditText
                            value={r.days?.[d] ?? ""}
                            onSave={(v) => setDay(r, d, v)}
                            className="w-16 text-center text-xs"
                          />
                          <button
                            onClick={() => cycleDayStatus(r, d)}
                            title={
                              st
                                ? `${DAY_STATUS_LABEL[st]} — click to change`
                                : "Mark billing color"
                            }
                            className={`h-4 w-4 shrink-0 rounded-full border ${
                              st === "billed"
                                ? "border-recovered bg-recovered"
                                : st === "pending"
                                  ? "border-gold bg-gold"
                                  : st === "scholarship"
                                    ? "border-risk bg-risk"
                                    : "border-surface-border bg-surface"
                            }`}
                          />
                        </div>
                      </td>
                    );
                  })}
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
                  <td className="td p-0.5">
                    <EditMoney
                      value={r.gn_rate ?? null}
                      onSave={(v) => save(r.id, { gn_rate: v })}
                      className="w-20 text-xs"
                    />
                  </td>
                  <td
                    className="td text-right font-mono text-xs"
                    title={`${act.GN ?? 0} GN × ${money(rateFor(r))} per GN × 30%`}
                  >
                    {money(expectedFor(r))}
                  </td>
                  <td
                    className="td p-0.5"
                    title={
                      pulledPaid(r) > 0
                        ? `Auto-pulled from Payments: ${money(pulledPaid(r))} (leave blank to use it, or type to override)`
                        : "No matching payments yet — enter manually or import payments"
                    }
                  >
                    <EditMoney
                      value={r.paid_amount ?? null}
                      onSave={(v) => save(r.id, { paid_amount: v })}
                      className="w-24 text-xs"
                      placeholder={pulledPaid(r) > 0 ? `${money(pulledPaid(r))} auto` : "$"}
                    />
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
