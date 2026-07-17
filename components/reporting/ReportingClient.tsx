"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import { money, num } from "@/lib/format";
import ExportButton, { type ExportRow } from "@/components/overview/ExportButton";
import type { Facility, Profile } from "@/lib/types";

type ProdRow = {
  id: string;
  collector_id: string | null;
  claim_id: string | null;
  facility_id: string | null;
  worked_on: string; // yyyy-mm-dd
};
type AnyRow = Record<string, unknown>;

type Dept =
  | "collectors"
  | "repricing"
  | "negotiations"
  | "payments"
  | "authorizations"
  | "auth_issues";

function toNum(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return isFinite(n) ? n : 0;
}
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
function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  for (let i = 0; i < 400 && cur <= to; i++) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}
function weekdayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
  });
}

const DEPTS: { key: Dept; label: string }[] = [
  { key: "collectors", label: "Collectors" },
  { key: "repricing", label: "Repricing" },
  { key: "negotiations", label: "Negotiations" },
  { key: "payments", label: "Payments" },
  { key: "authorizations", label: "Authorizations" },
  { key: "auth_issues", label: "Auth Issues" },
];

export default function ReportingClient({
  facilities,
  collectors,
  roster = [],
}: {
  facilities: Facility[];
  collectors: Profile[];
  roster?: Profile[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const today = todayStr();

  const [dept, setDept] = useState<Dept>("collectors");
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const [collectorFilter, setCollectorFilter] = useState("all");
  const [facilityFilter, setFacilityFilter] = useState("all");

  const [logs, setLogs] = useState<ProdRow[]>([]);
  const [deptRows, setDeptRows] = useState<AnyRow[]>([]);
  const [loading, setLoading] = useState(true);

  const facName = useCallback(
    (id: string | null) =>
      facilities.find((f) => f.id === id)?.short_name ||
      facilities.find((f) => f.id === id)?.name ||
      "—",
    [facilities]
  );
  const colName = useCallback(
    (id: string | null) => {
      const c = collectors.find((c) => c.id === id) || roster.find((p) => p.id === id);
      return c?.full_name || c?.initials || (id ? id.slice(0, 8) : "—");
    },
    [collectors, roster]
  );

  // Always pull a window wide enough to cover the selected range AND the last
  // two weeks (for the week-over-week comparison).
  const wideFrom = useMemo(() => {
    const wow = addDays(today, -13);
    return from < wow ? from : wow;
  }, [from, today]);
  const wideTo = useMemo(() => (to > today ? to : today), [to, today]);

  const loadCollectors = useCallback(async () => {
    setLoading(true);
    const prod = await selectAll<ProdRow>((f, t) =>
      supabase
        .from("production_log")
        .select("*")
        .gte("worked_on", wideFrom)
        .lte("worked_on", wideTo)
        .range(f, t)
    );
    setLogs(prod);
    setLoading(false);
  }, [supabase, wideFrom, wideTo]);

  const loadDept = useCallback(
    async (table: string) => {
      setLoading(true);
      const rows = await selectAll<AnyRow>((f, t) =>
        supabase.from(table).select("*").range(f, t)
      );
      setDeptRows(rows);
      setLoading(false);
    },
    [supabase]
  );

  useEffect(() => {
    if (dept === "collectors") loadCollectors();
    else loadDept(dept);
  }, [dept, loadCollectors, loadDept]);

  const preset = (kind: "today" | "7" | "30" | "month") => {
    if (kind === "today") {
      setFrom(today);
      setTo(today);
    } else if (kind === "7") {
      setFrom(addDays(today, -6));
      setTo(today);
    } else if (kind === "30") {
      setFrom(addDays(today, -29));
      setTo(today);
    } else {
      setFrom(today.slice(0, 8) + "01");
      setTo(today);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* department switcher */}
      <div className="flex flex-wrap items-center gap-2">
        {DEPTS.map((d) => (
          <button
            key={d.key}
            onClick={() => setDept(d.key)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${
              dept === d.key
                ? "bg-command text-command-text"
                : "border border-surface-border bg-surface-card text-surface-muted hover:bg-surface"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      {dept === "collectors" ? (
        <CollectorsReport
          today={today}
          from={from}
          to={to}
          setFrom={setFrom}
          setTo={setTo}
          preset={preset}
          collectorFilter={collectorFilter}
          setCollectorFilter={setCollectorFilter}
          facilityFilter={facilityFilter}
          setFacilityFilter={setFacilityFilter}
          collectors={collectors}
          facilities={facilities}
          logs={logs}
          loading={loading}
          facName={facName}
          colName={colName}
        />
      ) : dept === "authorizations" || dept === "auth_issues" ? (
        <AuthReport
          dept={dept}
          today={today}
          rows={deptRows}
          loading={loading}
          facilities={facilities}
          facilityFilter={facilityFilter}
          setFacilityFilter={setFacilityFilter}
          facName={facName}
          colName={colName}
          roster={roster}
        />
      ) : (
        <DeptReport
          dept={dept}
          today={today}
          rows={deptRows}
          loading={loading}
          facilities={facilities}
          facilityFilter={facilityFilter}
          setFacilityFilter={setFacilityFilter}
          facName={facName}
        />
      )}
    </div>
  );
}

/* ============================ Collectors ============================ */

function CollectorsReport({
  today,
  from,
  to,
  setFrom,
  setTo,
  preset,
  collectorFilter,
  setCollectorFilter,
  facilityFilter,
  setFacilityFilter,
  collectors,
  facilities,
  logs,
  loading,
  facName,
  colName,
}: {
  today: string;
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  preset: (k: "today" | "7" | "30" | "month") => void;
  collectorFilter: string;
  setCollectorFilter: (v: string) => void;
  facilityFilter: string;
  setFacilityFilter: (v: string) => void;
  collectors: Profile[];
  facilities: Facility[];
  logs: ProdRow[];
  loading: boolean;
  facName: (id: string | null) => string;
  colName: (id: string | null) => string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const days = useMemo(() => dateRange(from, to), [from, to]);

  // Notes drill-down: claims a collector worked in range, with their notes.
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailRows, setDetailRows] = useState<
    {
      worked_on: string;
      claim_id: string;
      patient: string;
      facility: string;
      age: number | null;
      notes: string;
      initials: string;
    }[]
  >([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const inRange = useCallback(
    (d: string) => d >= from && d <= to,
    [from, to]
  );
  const matchFilters = useCallback(
    (l: ProdRow) =>
      (collectorFilter === "all" || l.collector_id === collectorFilter) &&
      (facilityFilter === "all" || l.facility_id === facilityFilter),
    [collectorFilter, facilityFilter]
  );

  // worked events within the selected range
  const ranged = useMemo(
    () => logs.filter((l) => inRange(l.worked_on) && matchFilters(l)),
    [logs, inRange, matchFilters]
  );

  // Load the notes a collector wrote on the claims they worked in range.
  const openNotes = useCallback(
    async (collectorId: string) => {
      setDetailId(collectorId);
      setDetailLoading(true);
      setDetailRows([]);
      const events = logs.filter(
        (l) =>
          l.collector_id === collectorId &&
          inRange(l.worked_on) &&
          (facilityFilter === "all" || l.facility_id === facilityFilter)
      );
      const ids = Array.from(new Set(events.map((e) => e.claim_id).filter(Boolean))) as string[];
      const workMap: Record<string, { notes: string; initials: string }> = {};
      const patMap: Record<string, { patient: string; age: number | null }> = {};
      for (let i = 0; i < ids.length; i += 1000) {
        const slice = ids.slice(i, i + 1000);
        const { data: w } = await supabase
          .from("claim_work")
          .select("claim_id,notes,initials")
          .in("claim_id", slice);
        for (const row of (w as { claim_id: string; notes: string; initials: string }[]) ?? [])
          workMap[row.claim_id] = { notes: row.notes ?? "", initials: row.initials ?? "" };
        const { data: c } = await supabase
          .from("claims")
          .select("claim_id,patient_name,age_days")
          .in("claim_id", slice);
        for (const row of (c as { claim_id: string; patient_name: string; age_days: number | null }[]) ?? [])
          patMap[row.claim_id] = { patient: row.patient_name ?? "", age: row.age_days };
      }
      const rows = events
        .map((e) => ({
          worked_on: e.worked_on,
          claim_id: e.claim_id ?? "",
          patient: patMap[e.claim_id ?? ""]?.patient || "—",
          facility: facName(e.facility_id),
          age: patMap[e.claim_id ?? ""]?.age ?? null,
          notes: workMap[e.claim_id ?? ""]?.notes ?? "",
          initials: workMap[e.claim_id ?? ""]?.initials ?? "",
        }))
        .sort((a, b) => b.worked_on.localeCompare(a.worked_on));
      setDetailRows(rows);
      setDetailLoading(false);
    },
    [logs, inRange, facilityFilter, facName, supabase]
  );

  // per-collector aggregates over the range
  const perCollector = useMemo(() => {
    const map = new Map<string, { total: number; byDay: Map<string, number>; facs: Set<string> }>();
    for (const l of ranged) {
      const id = l.collector_id ?? "—";
      if (!map.has(id)) map.set(id, { total: 0, byDay: new Map(), facs: new Set() });
      const e = map.get(id)!;
      e.total += 1;
      e.byDay.set(l.worked_on, (e.byDay.get(l.worked_on) ?? 0) + 1);
      if (l.facility_id) e.facs.add(l.facility_id);
    }
    const rows = Array.from(map.entries()).map(([id, e]) => {
      const prof = collectors.find((c) => c.id === id);
      const target = prof?.daily_target ?? 100;
      const daysActive = e.byDay.size;
      const avg = daysActive ? e.total / daysActive : 0;
      const best = Math.max(0, ...Array.from(e.byDay.values()));
      return {
        id,
        name: colName(id),
        title: prof?.job_title ?? "—",
        target,
        total: e.total,
        daysActive,
        avg,
        best,
        attainment: target ? avg / target : 0,
        facs: e.facs.size,
        byDay: e.byDay,
      };
    });
    rows.sort((a, b) => b.total - a.total);
    return rows;
  }, [ranged, collectors, colName]);

  const perDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of ranged) m.set(l.worked_on, (m.get(l.worked_on) ?? 0) + 1);
    return m;
  }, [ranged]);

  const grandTotal = ranged.length;
  const activeCollectors = perCollector.length;
  const bestDay = Math.max(0, ...Array.from(perDay.values()));
  const best = perCollector[0]; // sorted by total desc

  // ---- week over week (fixed windows relative to today) ----
  const twStart = addDays(today, -6);
  const lwStart = addDays(today, -13);
  const lwEnd = addDays(today, -7);
  const wow = useMemo(() => {
    const fw = (l: ProdRow) =>
      facilityFilter === "all" || l.facility_id === facilityFilter;
    const fc = (l: ProdRow) =>
      collectorFilter === "all" || l.collector_id === collectorFilter;
    let tw = 0,
      lw = 0;
    for (const l of logs) {
      if (!fw(l) || !fc(l)) continue;
      if (l.worked_on >= twStart && l.worked_on <= today) tw++;
      else if (l.worked_on >= lwStart && l.worked_on <= lwEnd) lw++;
    }
    // per collector
    const per = new Map<string, { tw: number; lw: number }>();
    for (const l of logs) {
      if (!fw(l) || !fc(l)) continue;
      const id = l.collector_id ?? "—";
      if (!per.has(id)) per.set(id, { tw: 0, lw: 0 });
      const e = per.get(id)!;
      if (l.worked_on >= twStart && l.worked_on <= today) e.tw++;
      else if (l.worked_on >= lwStart && l.worked_on <= lwEnd) e.lw++;
    }
    return { tw, lw, per };
  }, [logs, twStart, lwStart, lwEnd, today, facilityFilter, collectorFilter]);

  // Collectors who need attention: little/no production this week.
  const needsAttention = useMemo(() => {
    return collectors
      .map((c) => {
        const e = wow.per.get(c.id) ?? { tw: 0, lw: 0 };
        const target = c.daily_target ?? 100;
        // rough weekly expectation = target * 5 working days
        const weekly = target * 5;
        return { c, tw: e.tw, lw: e.lw, pct: weekly ? e.tw / weekly : 0 };
      })
      .filter((x) => x.tw === 0 || x.pct < 0.5)
      .sort((a, b) => a.tw - b.tw);
  }, [collectors, wow]);

  const exportRows: ExportRow[] = useMemo(
    () =>
      perCollector.map((r) => {
        const base: ExportRow = {
          Collector: r.name,
          "Job Title": r.title,
          "Daily Target": r.target,
          "Worked (range)": r.total,
          "Days Active": r.daysActive,
          "Avg / Day": Math.round(r.avg * 10) / 10,
          "Best Day": r.best,
          "Target Attainment %": Math.round(r.attainment * 100),
          "This Week": wow.per.get(r.id)?.tw ?? 0,
          "Last Week": wow.per.get(r.id)?.lw ?? 0,
          Facilities: r.facs,
        };
        for (const d of days) base[weekdayLabel(d)] = r.byDay.get(d) ?? 0;
        return base;
      }),
    [perCollector, days, wow]
  );

  const wowDelta = wow.lw ? Math.round(((wow.tw - wow.lw) / wow.lw) * 100) : null;

  return (
    <div className="space-y-5">
      <Controls
        from={from}
        to={to}
        setFrom={setFrom}
        setTo={setTo}
        preset={preset}
        collectorFilter={collectorFilter}
        setCollectorFilter={setCollectorFilter}
        facilityFilter={facilityFilter}
        setFacilityFilter={setFacilityFilter}
        collectors={collectors}
        facilities={facilities}
        exportRows={exportRows}
        exportName={`staff-production_${from}_to_${to}.xlsx`}
      />

      {/* headline */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Worked (range)" value={num(grandTotal)} accent="recovered" />
        <Stat label="Active Collectors" value={num(activeCollectors)} />
        <Stat label="Best Single Day" value={num(bestDay)} />
        <Stat label="This Week" value={num(wow.tw)} accent="recovered" />
        <Stat
          label="vs Last Week"
          value={wowDelta === null ? "—" : `${wowDelta > 0 ? "+" : ""}${wowDelta}%`}
          accent={wowDelta !== null && wowDelta < 0 ? "risk" : "recovered"}
        />
      </div>

      {/* best collector + needs attention */}
      {!loading && (best || needsAttention.length > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          {best && best.total > 0 && (
            <div className="card border-l-4 border-l-recovered p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-surface-muted">
                🏆 Top collector ({from} – {to})
              </div>
              <div className="mt-1 font-display text-xl font-bold">{best.name}</div>
              <div className="text-sm text-surface-muted">
                {best.total} worked · {Math.round(best.attainment * 100)}% of target · avg{" "}
                {Math.round(best.avg * 10) / 10}/day
              </div>
            </div>
          )}
          {needsAttention.length > 0 && (
            <div className="card border-l-4 border-l-risk p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-surface-muted">
                ⚠ Needs attention (low output this week)
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {needsAttention.map((x) => (
                  <span
                    key={x.c.id}
                    className="badge bg-risk/10 text-risk"
                    title={`This week ${x.tw}, last week ${x.lw}`}
                  >
                    {x.c.full_name || x.c.id.slice(0, 8)} · {x.tw} this wk
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="card p-10 text-center text-surface-muted">Loading production…</div>
      )}

      {!loading && grandTotal === 0 && (
        <div className="card p-10 text-center text-surface-muted">
          No production recorded in this range yet. As collectors mark claims “✓
          Worked” in their Queue, their activity shows up here.
        </div>
      )}

      {!loading && grandTotal > 0 && (
        <>
          {/* per-collector summary */}
          <div className="card overflow-hidden">
            <div className="border-b border-surface-border px-4 py-3 font-semibold">
              Staff production — {from} to {to}
            </div>
            <div className="scroll-x overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface">
                  <tr>
                    <th className="th text-left">Collector</th>
                    <th className="th text-left">Title</th>
                    <th className="th text-right">Target</th>
                    <th className="th text-right">Worked</th>
                    <th className="th text-right">Days</th>
                    <th className="th text-right">Avg/Day</th>
                    <th className="th text-right">Best</th>
                    <th className="th text-right">Attainment</th>
                    <th className="th text-right">This Wk</th>
                    <th className="th text-right">Last Wk</th>
                    <th className="th"></th>
                  </tr>
                </thead>
                <tbody>
                  {perCollector.map((r, i) => {
                    const w = wow.per.get(r.id) ?? { tw: 0, lw: 0 };
                    return (
                      <tr key={r.id} className={i % 2 ? "bg-surface/40" : ""}>
                        <td className="td font-medium">{r.name}</td>
                        <td className="td text-xs text-surface-muted">{r.title}</td>
                        <td className="td text-right font-mono">{r.target}</td>
                        <td className="td text-right font-mono font-semibold">{r.total}</td>
                        <td className="td text-right font-mono">{r.daysActive}</td>
                        <td className="td text-right font-mono">{Math.round(r.avg * 10) / 10}</td>
                        <td className="td text-right font-mono">{r.best}</td>
                        <td className="td text-right">
                          <AttainmentBadge pct={r.attainment} />
                        </td>
                        <td className="td text-right font-mono">{w.tw}</td>
                        <td className="td text-right font-mono text-surface-muted">{w.lw}</td>
                        <td className="td text-right">
                          <button
                            onClick={() => openNotes(r.id)}
                            className="badge bg-brand-blue/15 px-2 py-1 text-[11px] font-semibold text-brand-blue hover:bg-brand-blue/25"
                          >
                            📝 Notes
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-surface-border bg-surface font-semibold">
                    <td className="td" colSpan={3}>
                      Total
                    </td>
                    <td className="td text-right font-mono">{grandTotal}</td>
                    <td className="td" colSpan={7}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* daily grid */}
          <div className="card overflow-hidden">
            <div className="border-b border-surface-border px-4 py-3 font-semibold">
              Daily production grid
            </div>
            <div className="scroll-x overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface">
                  <tr>
                    <th className="th sticky left-0 z-10 bg-surface text-left">Collector</th>
                    {days.map((d) => (
                      <th key={d} className="th text-right whitespace-nowrap">
                        {weekdayLabel(d)}
                      </th>
                    ))}
                    <th className="th text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {perCollector.map((r, i) => (
                    <tr key={r.id} className={i % 2 ? "bg-surface/40" : ""}>
                      <td className="td sticky left-0 z-10 bg-inherit font-medium">{r.name}</td>
                      {days.map((d) => {
                        const v = r.byDay.get(d) ?? 0;
                        const hit = v >= r.target;
                        return (
                          <td
                            key={d}
                            className={`td text-right font-mono ${
                              v === 0
                                ? "text-surface-muted"
                                : hit
                                  ? "font-semibold text-recovered"
                                  : ""
                            }`}
                          >
                            {v || "·"}
                          </td>
                        );
                      })}
                      <td className="td text-right font-mono font-semibold">{r.total}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-surface-border bg-surface font-semibold">
                    <td className="td sticky left-0 z-10 bg-surface">All staff</td>
                    {days.map((d) => (
                      <td key={d} className="td text-right font-mono">
                        {perDay.get(d) ?? 0}
                      </td>
                    ))}
                    <td className="td text-right font-mono">{grandTotal}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}

      {/* notes drill-down modal */}
      {detailId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setDetailId(null)}
        >
          <div
            className="card flex max-h-[80vh] w-full max-w-3xl flex-col p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold">
                {colName(detailId)} — notes ({from} to {to})
              </h3>
              <button
                onClick={() => setDetailId(null)}
                className="text-sm text-surface-muted hover:underline"
              >
                Close
              </button>
            </div>
            <div className="mt-3 min-h-0 flex-1 overflow-auto">
              {detailLoading && <p className="text-sm text-surface-muted">Loading…</p>}
              {!detailLoading && detailRows.length === 0 && (
                <p className="text-sm text-surface-muted">No worked claims in this range.</p>
              )}
              {!detailLoading && detailRows.length > 0 && (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface">
                    <tr>
                      <th className="th text-left">Date</th>
                      <th className="th text-left">Patient</th>
                      <th className="th text-left">Facility</th>
                      <th className="th text-right">Age</th>
                      <th className="th text-left">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailRows.map((d, i) => (
                      <tr key={`${d.claim_id}-${i}`} className={i % 2 ? "bg-surface/40" : ""}>
                        <td className="td whitespace-nowrap text-xs">{d.worked_on}</td>
                        <td className="td font-medium">{d.patient}</td>
                        <td className="td text-xs text-surface-muted">{d.facility}</td>
                        <td className="td text-right font-mono">{d.age ?? "—"}{d.age != null ? "d" : ""}</td>
                        <td className="td whitespace-pre-wrap">{d.notes || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="mt-3 text-right">
              <ExportButton
                rows={detailRows.map((d) => ({
                  Date: d.worked_on,
                  Patient: d.patient,
                  Facility: d.facility,
                  "Age (days)": d.age ?? "",
                  "Claim ID": d.claim_id,
                  Initials: d.initials,
                  Notes: d.notes,
                }))}
                filename={`${colName(detailId)}_notes_${from}_to_${to}.xlsx`}
                sheet="Notes"
                label="Export notes"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================ Departments ============================ */

function DeptReport({
  dept,
  today,
  rows,
  loading,
  facilities,
  facilityFilter,
  setFacilityFilter,
  facName,
}: {
  dept: Dept;
  today: string;
  rows: AnyRow[];
  loading: boolean;
  facilities: Facility[];
  facilityFilter: string;
  setFacilityFilter: (v: string) => void;
  facName: (id: string | null) => string;
}) {
  // The money column + label per department.
  const cfg: Record<
    "repricing" | "negotiations" | "payments",
    { amountKey: string; label: string; secondKey?: string; secondLabel?: string }
  > = {
    repricing: {
      amountKey: "additional_payment",
      label: "Additional $ collected",
      secondKey: "amt_allowed",
      secondLabel: "Allowed",
    },
    payments: { amountKey: "paid_amount", label: "Collected" },
    negotiations: {
      amountKey: "extra_paid",
      label: "Extra paid",
      secondKey: "negotiated_amount",
      secondLabel: "Negotiated",
    },
  };
  const c = cfg[dept as "repricing" | "negotiations" | "payments"];

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) => facilityFilter === "all" || (r.facility_id as string) === facilityFilter
      ),
    [rows, facilityFilter]
  );

  const twStart = addDays(today, -6);
  const lwStart = addDays(today, -13);
  const lwEnd = addDays(today, -7);

  const stats = useMemo(() => {
    let total = 0,
      second = 0,
      tw = 0,
      lw = 0;
    const byFac = new Map<string, { amt: number; count: number }>();
    for (const r of filtered) {
      const amt = toNum(r[c.amountKey]);
      total += amt;
      if (c.secondKey) second += toNum(r[c.secondKey]);
      const fid = (r.facility_id as string) ?? "—";
      if (!byFac.has(fid)) byFac.set(fid, { amt: 0, count: 0 });
      const e = byFac.get(fid)!;
      e.amt += amt;
      e.count += 1;
      const d = String(r.updated_at ?? "").slice(0, 10);
      if (d >= twStart && d <= today) tw += amt;
      else if (d >= lwStart && d <= lwEnd) lw += amt;
    }
    const facRows = Array.from(byFac.entries())
      .map(([id, e]) => ({ id, name: facName(id), ...e }))
      .sort((a, b) => b.amt - a.amt);
    return { total, second, tw, lw, facRows, count: filtered.length };
  }, [filtered, c, twStart, lwStart, lwEnd, today, facName]);

  const delta = stats.lw ? Math.round(((stats.tw - stats.lw) / stats.lw) * 100) : null;

  const exportRows: ExportRow[] = useMemo(
    () =>
      stats.facRows.map((f) => ({
        Facility: f.name,
        [c.label]: Math.round(f.amt),
        Rows: f.count,
      })),
    [stats.facRows, c.label]
  );

  return (
    <div className="space-y-5">
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <span className="label">Facility</span>
          <select
            value={facilityFilter}
            onChange={(e) => setFacilityFilter(e.target.value)}
            className="input min-w-[14rem]"
          >
            <option value="all">All facilities</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.short_name || f.name}
              </option>
            ))}
          </select>
        </div>
        <div className="ml-auto">
          <ExportButton
            rows={exportRows}
            filename={`${dept}-summary.xlsx`}
            sheet="Summary"
            label="Export"
          />
        </div>
      </div>

      {loading ? (
        <div className="card p-10 text-center text-surface-muted">Loading {dept}…</div>
      ) : stats.count === 0 ? (
        <div className="card p-10 text-center text-surface-muted">
          No {dept} data yet. Import on the {dept} tab to populate this report.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label={c.label} value={money(stats.total)} accent="recovered" />
            {c.secondKey && <Stat label={c.secondLabel!} value={money(stats.second)} />}
            <Stat label="Records" value={num(stats.count)} />
            <Stat label="Updated this wk" value={money(stats.tw)} accent="gold" />
            <Stat
              label="vs last wk"
              value={delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta}%`}
              accent={delta !== null && delta < 0 ? "risk" : "recovered"}
            />
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-surface-border px-4 py-3 font-semibold">
              {c.label} by facility
            </div>
            <div className="scroll-x overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface">
                  <tr>
                    <th className="th text-left">Facility</th>
                    <th className="th text-right">{c.label}</th>
                    <th className="th text-right">Records</th>
                    <th className="th text-right">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.facRows.map((f, i) => (
                    <tr key={f.id} className={i % 2 ? "bg-surface/40" : ""}>
                      <td className="td font-medium">{f.name}</td>
                      <td className="td text-right font-mono font-semibold">{money(f.amt)}</td>
                      <td className="td text-right font-mono text-surface-muted">{f.count}</td>
                      <td className="td text-right font-mono text-surface-muted">
                        {stats.total ? Math.round((f.amt / stats.total) * 100) : 0}%
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-surface-border bg-surface font-semibold">
                    <td className="td">Total</td>
                    <td className="td text-right font-mono">{money(stats.total)}</td>
                    <td className="td text-right font-mono">{stats.count}</td>
                    <td className="td"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <p className="text-xs text-surface-muted">
            “Updated this week / last week” compares the dollar value of rows last
            touched in each 7-day window — a quick read on movement. Totals reflect
            everything currently imported for the selected facility.
          </p>
        </>
      )}
    </div>
  );
}

/* ===================== Authorizations / Auth Issues ===================== */

const AUTH_ISSUE_STATUS_LIST = ["Not Worked", "Working", "Completed"];

function AuthReport({
  dept,
  today,
  rows,
  loading,
  facilities,
  facilityFilter,
  setFacilityFilter,
  facName,
  colName,
  roster,
}: {
  dept: "authorizations" | "auth_issues";
  today: string;
  rows: AnyRow[];
  loading: boolean;
  facilities: Facility[];
  facilityFilter: string;
  setFacilityFilter: (v: string) => void;
  facName: (id: string | null) => string;
  colName: (id: string | null) => string;
  roster: Profile[];
}) {
  // Filter by the utilization person who last worked the record (updated_by).
  const [person, setPerson] = useState("all");
  // Daily production window.
  const [prodFrom, setProdFrom] = useState(addDays(today, -6));
  const [prodTo, setProdTo] = useState(today);

  // Daily production comes from the per-action activity log (auth_activity):
  // every edit is credited to whoever made it on the day it happened.
  const supabase = useMemo(() => createClient(), []);
  const recordType = dept === "authorizations" ? "authorization" : "auth_issue";
  const [activity, setActivity] = useState<AnyRow[]>([]);
  useEffect(() => {
    let cancel = false;
    (async () => {
      const rowsA = await selectAll<AnyRow>((f, t) =>
        supabase
          .from("auth_activity")
          .select("*")
          .eq("record_type", recordType)
          .gte("worked_on", prodFrom)
          .lte("worked_on", prodTo)
          .range(f, t)
      ).catch(() => [] as AnyRow[]);
      if (!cancel) setActivity(rowsA);
    })();
    return () => {
      cancel = true;
    };
  }, [supabase, recordType, prodFrom, prodTo]);

  // "Worked by" options: the whole internal roster (so a specialist shows even
  // before they've worked a record), plus anyone who appears as an editor /
  // activity actor but isn't on the roster.
  const people = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; name: string }[] = [];
    for (const p of roster) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push({ id: p.id, name: p.full_name || p.initials || colName(p.id) });
    }
    for (const r of rows) {
      const id = (r.updated_by as string) ?? "";
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push({ id, name: colName(id) });
      }
    }
    for (const a of activity) {
      const id = (a.actor_id as string) ?? "";
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push({ id, name: colName(id) });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [roster, rows, activity, colName]);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (facilityFilter === "all" || (r.facility_id as string) === facilityFilter) &&
          (person === "all" || (r.updated_by as string) === person)
      ),
    [rows, facilityFilter, person]
  );

  const production = useMemo(() => {
    const days = dateRange(prodFrom, prodTo);
    // Count each record once per person per day (many edits = one credit/day).
    const seen = new Set<string>();
    const byPerson = new Map<string, { total: number; perDay: Record<string, number> }>();
    for (const a of activity) {
      if (facilityFilter !== "all" && (a.facility_id as string) !== facilityFilter) continue;
      if (person !== "all" && (a.actor_id as string) !== person) continue;
      const d = String(a.worked_on ?? "").slice(0, 10);
      if (!d || d < prodFrom || d > prodTo) continue;
      const actor = (a.actor_id as string) ?? "—";
      const rid = (a.record_id as string) ?? (a.id as string);
      const key = `${actor}|${d}|${rid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!byPerson.has(actor)) byPerson.set(actor, { total: 0, perDay: {} });
      const e = byPerson.get(actor)!;
      e.total += 1;
      e.perDay[d] = (e.perDay[d] ?? 0) + 1;
    }
    const rowsOut = Array.from(byPerson.entries())
      .map(([id, e]) => ({ id, name: colName(id), ...e }))
      .sort((a, b) => b.total - a.total);
    const dayTotals = days.map((d) => rowsOut.reduce((s, p) => s + (p.perDay[d] ?? 0), 0));
    return { days, rows: rowsOut, dayTotals, grand: rowsOut.reduce((s, p) => s + p.total, 0) };
  }, [activity, facilityFilter, person, prodFrom, prodTo, colName]);

  // ----- Authorizations -----
  const authStats = useMemo(() => {
    let active = 0;
    let discharged = 0;
    let activeDays = 0;
    let pending = 0; // active auths still in "Pending" status
    let reviewsDue = 0; // active auths with a review date in the next 7 days
    let pastDue = 0; // active auths whose review date is before today
    // Review dates are entered free-form (e.g. "7/14/2025"), so parse to a
    // day timestamp instead of comparing strings.
    const parseDay = (s: unknown): number | null => {
      const t = Date.parse(String(s ?? "").trim());
      if (isNaN(t)) return null;
      const d = new Date(t);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    };
    const todayMs = parseDay(today)!;
    const soonMs = parseDay(addDays(today, 7))!;
    // Count PER PATIENT (matching the Authorizations tab): group every auth
    // record by facility + patient name, then use only that patient's CURRENT
    // (most-recently-begun) authorization. A patient with several auth lines —
    // an initial auth plus reviews, or a PHP→IOP step-down — is counted once,
    // otherwise Reporting over-counts vs. the Authorizations board.
    const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
    const recency = (r: AnyRow): number => {
      const begun = [r.start_date, r.admit_date]
        .map((v) => Date.parse(String(v ?? "").trim()))
        .filter((t) => !isNaN(t)) as number[];
      if (begun.length) return Math.max(...begun);
      const c = Date.parse(String(r.created_at ?? ""));
      return isNaN(c) ? 0 : c;
    };
    const byPatient = new Map<string, AnyRow[]>();
    for (const r of filtered) {
      const key = `${(r.facility_id as string) ?? ""}||${norm(r.patient_name)}`;
      if (!byPatient.has(key)) byPatient.set(key, []);
      byPatient.get(key)!.push(r);
    }
    const byLoc = new Map<string, { patients: number; days: number }>();
    const byFac = new Map<string, { total: number; active: number; days: number }>();
    for (const auths of byPatient.values()) {
      auths.sort((a, b) => recency(b) - recency(a));
      const r = auths[0]; // this patient's current authorization
      // A patient is off the active board once the discharged toggle is set OR
      // the discharge date has arrived (imports bring the date, not the toggle).
      // So they don't count as active, pending, past due, or review due.
      const dischMs = parseDay(r.discharge_date);
      const isDischarged =
        Boolean(r.discharged) || (dischMs != null && dischMs <= todayMs);
      const days = toNum(r.total_days);
      const fid = (r.facility_id as string) ?? "—";
      if (!byFac.has(fid)) byFac.set(fid, { total: 0, active: 0, days: 0 });
      const fe = byFac.get(fid)!;
      fe.total += 1;
      if (isDischarged) {
        discharged += 1;
      } else {
        active += 1;
        activeDays += days;
        fe.active += 1;
        fe.days += days;
        if (/pending/.test(String(r.status ?? "").toLowerCase())) pending += 1;
        const loc = String(r.level_of_care ?? "").trim();
        if (loc) {
          if (!byLoc.has(loc)) byLoc.set(loc, { patients: 0, days: 0 });
          const le = byLoc.get(loc)!;
          le.patients += 1;
          le.days += days;
        }
        const nrMs = parseDay(r.next_review_date);
        if (nrMs != null) {
          if (nrMs >= todayMs && nrMs <= soonMs) reviewsDue += 1;
          else if (nrMs < todayMs) pastDue += 1;
        }
      }
    }
    // New auths created within the production date range.
    const newAuths = filtered.filter((r) => {
      const c = String(r.created_at ?? "").slice(0, 10);
      return c && c >= prodFrom && c <= prodTo;
    }).length;
    return {
      total: byPatient.size, // patients, not raw auth records
      totalRecords: filtered.length,
      active,
      discharged,
      activeDays,
      pending,
      pastDue,
      reviewsDue,
      newAuths,
      locRows: Array.from(byLoc.entries())
        .map(([loc, e]) => ({ loc, ...e }))
        .sort((a, b) => b.patients - a.patients),
      facRows: Array.from(byFac.entries())
        .map(([id, e]) => ({ id, name: facName(id), ...e }))
        .sort((a, b) => b.active - a.active),
    };
  }, [filtered, today, facName, prodFrom, prodTo]);

  // Auth notes drill-down: every auth carrying a note, newest first.
  const authNotes = useMemo(() => {
    return filtered
      .filter((r) => String(r.notes ?? "").trim())
      .map((r) => ({
        patient: String(r.patient_name ?? "—"),
        loc: String(r.level_of_care ?? ""),
        note: String(r.notes ?? ""),
        by: colName((r.updated_by as string) ?? null),
        when: String(r.updated_at ?? "").slice(0, 10),
        facility: facName((r.facility_id as string) ?? null),
      }))
      .sort((a, b) => b.when.localeCompare(a.when));
  }, [filtered, colName, facName]);

  // ----- Auth Issues -----
  const issueStats = useMemo(() => {
    const byStatus: Record<string, number> = {};
    let mgmt = 0;
    let atStake = 0;
    let fromCollections = 0;
    let completed = 0;
    const byFac = new Map<
      string,
      { total: number; open: number; completed: number; atStake: number }
    >();
    for (const r of filtered) {
      const status = String(r.status ?? "").trim() || "Not Worked";
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      const isDone = status === "Completed";
      if (isDone) completed += 1;
      if (r.mgmt_needed) mgmt += 1;
      if (r.from_collection) fromCollections += 1;
      const amt = toNum(r.charge_amount);
      if (!isDone) atStake += amt;
      const fid = (r.facility_id as string) ?? "—";
      if (!byFac.has(fid)) byFac.set(fid, { total: 0, open: 0, completed: 0, atStake: 0 });
      const fe = byFac.get(fid)!;
      fe.total += 1;
      if (isDone) fe.completed += 1;
      else {
        fe.open += 1;
        fe.atStake += amt;
      }
    }
    return {
      total: filtered.length,
      byStatus,
      mgmt,
      atStake,
      fromCollections,
      completed,
      facRows: Array.from(byFac.entries())
        .map(([id, e]) => ({ id, name: facName(id), ...e }))
        .sort((a, b) => b.open - a.open),
    };
  }, [filtered, facName]);

  const exportRows: ExportRow[] = useMemo(() => {
    if (dept === "authorizations") {
      return authStats.facRows.map((f) => ({
        Facility: f.name,
        Active: f.active,
        Discharged: f.total - f.active,
        "Auth Days (active)": f.days,
        Total: f.total,
      }));
    }
    return issueStats.facRows.map((f) => ({
      Facility: f.name,
      Open: f.open,
      Completed: f.completed,
      "$ At Stake": Math.round(f.atStake),
      Total: f.total,
    }));
  }, [dept, authStats.facRows, issueStats.facRows]);

  return (
    <div className="space-y-5">
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <span className="label">Facility</span>
          <select
            value={facilityFilter}
            onChange={(e) => setFacilityFilter(e.target.value)}
            className="input min-w-[14rem]"
          >
            <option value="all">All facilities</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.short_name || f.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="label">Worked by</span>
          <select
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            className="input min-w-[12rem]"
          >
            <option value="all">Everyone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="ml-auto">
          <ExportButton
            rows={exportRows}
            filename={`${dept}-summary.xlsx`}
            sheet="Summary"
            label="Export"
          />
        </div>
      </div>

      {loading ? (
        <div className="card p-10 text-center text-surface-muted">
          Loading {dept === "authorizations" ? "authorizations" : "auth issues"}…
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-10 text-center text-surface-muted">
          No {dept === "authorizations" ? "authorizations" : "auth issues"} yet for the
          selected facility.
        </div>
      ) : dept === "authorizations" ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
            <Stat label="Active patients" value={num(authStats.active)} accent="recovered" />
            <Stat label="New auths" value={num(authStats.newAuths)} accent="secured" />
            <Stat label="Past due" value={num(authStats.pastDue)} accent="risk" />
            <Stat label="Pending" value={num(authStats.pending)} accent="gold" />
            <Stat label="Discharged" value={num(authStats.discharged)} />
            <Stat label="Auth days (active)" value={num(authStats.activeDays)} accent="gold" />
            <Stat label="Reviews due ≤7d" value={num(authStats.reviewsDue)} accent="gold" />
            <Stat label="Patients" value={num(authStats.total)} />
          </div>

          <DailyProduction
            title="Daily production — auths worked"
            production={production}
            prodFrom={prodFrom}
            prodTo={prodTo}
            setProdFrom={setProdFrom}
            setProdTo={setProdTo}
            today={today}
          />

          <div className="card overflow-hidden">
            <div className="border-b border-surface-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-surface-muted">
              Active by level of care
            </div>
            <table className="w-full text-sm">
              <thead className="bg-surface">
                <tr>
                  <th className="th">Level of Care</th>
                  <th className="th text-right">Patients</th>
                  <th className="th text-right">Total Days</th>
                </tr>
              </thead>
              <tbody>
                {authStats.locRows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="td py-4 text-center text-surface-muted">
                      No level of care entered on active auths.
                    </td>
                  </tr>
                ) : (
                  authStats.locRows.map((l, i) => (
                    <tr key={l.loc} className={i % 2 ? "bg-surface/40" : ""}>
                      <td className="td font-medium">{l.loc}</td>
                      <td className="td text-right font-mono">{l.patients}</td>
                      <td className="td text-right font-mono">{l.days}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-surface-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-surface-muted">
              By facility
            </div>
            <table className="w-full text-sm">
              <thead className="bg-surface">
                <tr>
                  <th className="th">Facility</th>
                  <th className="th text-right">Active</th>
                  <th className="th text-right">Discharged</th>
                  <th className="th text-right">Auth Days</th>
                  <th className="th text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {authStats.facRows.map((f, i) => (
                  <tr key={f.id} className={i % 2 ? "bg-surface/40" : ""}>
                    <td className="td font-medium">{f.name}</td>
                    <td className="td text-right font-mono">{f.active}</td>
                    <td className="td text-right font-mono">{f.total - f.active}</td>
                    <td className="td text-right font-mono">{f.days}</td>
                    <td className="td text-right font-mono">{f.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-surface-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-surface-muted">
              Auth notes{" "}
              <span className="font-normal normal-case text-surface-muted">
                ({authNotes.length})
              </span>
            </div>
            {authNotes.length === 0 ? (
              <p className="px-4 py-4 text-center text-sm text-surface-muted">
                No auth notes for this selection.
              </p>
            ) : (
              <div className="scroll-x max-h-96 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface">
                    <tr>
                      <th className="th">Patient</th>
                      <th className="th">LOC</th>
                      <th className="th">Facility</th>
                      <th className="th min-w-[22rem]">Note</th>
                      <th className="th">By</th>
                      <th className="th">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {authNotes.slice(0, 200).map((n, i) => (
                      <tr key={i} className={i % 2 ? "bg-surface/40" : ""}>
                        <td className="td font-medium">{n.patient}</td>
                        <td className="td text-xs">{n.loc || "—"}</td>
                        <td className="td text-xs text-surface-muted">{n.facility}</td>
                        <td className="td whitespace-pre-wrap break-words text-xs">{n.note}</td>
                        <td className="td text-xs">{n.by}</td>
                        <td className="td text-xs text-surface-muted">{n.when || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat
              label="Open"
              value={num(issueStats.total - issueStats.completed)}
              accent="risk"
            />
            <Stat label="Completed" value={num(issueStats.completed)} accent="recovered" />
            <Stat label="Needs mgmt" value={num(issueStats.mgmt)} accent="gold" />
            <Stat label="$ at stake" value={money(issueStats.atStake)} />
            <Stat label="From Collections" value={num(issueStats.fromCollections)} />
          </div>

          <DailyProduction
            title="Daily production — auth issues worked"
            production={production}
            prodFrom={prodFrom}
            prodTo={prodTo}
            setProdFrom={setProdFrom}
            setProdTo={setProdTo}
            today={today}
          />

          <div className="card overflow-hidden">
            <div className="border-b border-surface-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-surface-muted">
              By status
            </div>
            <table className="w-full text-sm">
              <thead className="bg-surface">
                <tr>
                  <th className="th">Status</th>
                  <th className="th text-right">Count</th>
                </tr>
              </thead>
              <tbody>
                {AUTH_ISSUE_STATUS_LIST.map((s, i) => (
                  <tr key={s} className={i % 2 ? "bg-surface/40" : ""}>
                    <td className="td font-medium">{s}</td>
                    <td className="td text-right font-mono">{issueStats.byStatus[s] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-surface-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-surface-muted">
              By facility
            </div>
            <table className="w-full text-sm">
              <thead className="bg-surface">
                <tr>
                  <th className="th">Facility</th>
                  <th className="th text-right">Open</th>
                  <th className="th text-right">Completed</th>
                  <th className="th text-right">$ At Stake</th>
                  <th className="th text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {issueStats.facRows.map((f, i) => (
                  <tr key={f.id} className={i % 2 ? "bg-surface/40" : ""}>
                    <td className="td font-medium">{f.name}</td>
                    <td className="td text-right font-mono">{f.open}</td>
                    <td className="td text-right font-mono">{f.completed}</td>
                    <td className="td text-right font-mono">{money(f.atStake)}</td>
                    <td className="td text-right font-mono">{f.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function DailyProduction({
  title,
  production,
  prodFrom,
  prodTo,
  setProdFrom,
  setProdTo,
  today,
}: {
  title: string;
  production: {
    days: string[];
    rows: { id: string; name: string; total: number; perDay: Record<string, number> }[];
    dayTotals: number[];
    grand: number;
  };
  prodFrom: string;
  prodTo: string;
  setProdFrom: (v: string) => void;
  setProdTo: (v: string) => void;
  today: string;
}) {
  const exportRows: ExportRow[] = production.rows.map((p) => {
    const row: ExportRow = { Person: p.name };
    for (const d of production.days) row[weekdayLabel(d)] = p.perDay[d] ?? 0;
    row.Total = p.total;
    return row;
  });

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-surface-border px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-surface-muted">
          {title}
        </span>
        <label className="flex items-center gap-1 text-xs">
          <span className="text-surface-muted">From</span>
          <input
            type="date"
            value={prodFrom}
            max={prodTo}
            onChange={(e) => setProdFrom(e.target.value)}
            className="input py-1"
          />
        </label>
        <label className="flex items-center gap-1 text-xs">
          <span className="text-surface-muted">To</span>
          <input
            type="date"
            value={prodTo}
            max={today}
            onChange={(e) => setProdTo(e.target.value)}
            className="input py-1"
          />
        </label>
        <span className="text-xs text-surface-muted">
          {production.grand} worked in range
        </span>
        <div className="ml-auto">
          <ExportButton
            rows={exportRows}
            filename="auth-daily-production.xlsx"
            sheet="Production"
            label="Export"
          />
        </div>
      </div>
      {production.rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-surface-muted">
          No records worked in this date range.
        </p>
      ) : (
        <div className="scroll-x overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface">
              <tr>
                <th className="th sticky left-0 bg-surface">Person</th>
                {production.days.map((d) => (
                  <th key={d} className="th text-right">
                    {weekdayLabel(d)}
                  </th>
                ))}
                <th className="th text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {production.rows.map((p, i) => (
                <tr key={p.id} className={i % 2 ? "bg-surface/40" : ""}>
                  <td className="td sticky left-0 bg-inherit font-medium">{p.name}</td>
                  {production.days.map((d) => (
                    <td key={d} className="td text-right font-mono">
                      {p.perDay[d] ?? 0}
                    </td>
                  ))}
                  <td className="td text-right font-mono font-semibold">{p.total}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-surface-border font-semibold">
                <td className="td sticky left-0 bg-surface-card">Total</td>
                {production.dayTotals.map((t, idx) => (
                  <td key={idx} className="td text-right font-mono">
                    {t}
                  </td>
                ))}
                <td className="td text-right font-mono">{production.grand}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/* ============================ shared bits ============================ */

function Controls({
  from,
  to,
  setFrom,
  setTo,
  preset,
  collectorFilter,
  setCollectorFilter,
  facilityFilter,
  setFacilityFilter,
  collectors,
  facilities,
  exportRows,
  exportName,
}: {
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  preset: (k: "today" | "7" | "30" | "month") => void;
  collectorFilter: string;
  setCollectorFilter: (v: string) => void;
  facilityFilter: string;
  setFacilityFilter: (v: string) => void;
  collectors: Profile[];
  facilities: Facility[];
  exportRows: ExportRow[];
  exportName: string;
}) {
  return (
    <div className="card flex flex-wrap items-end gap-3 p-4">
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
            ["7", "Last 7"],
            ["30", "Last 30"],
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
        <span className="label">Collector</span>
        <select
          value={collectorFilter}
          onChange={(e) => setCollectorFilter(e.target.value)}
          className="input min-w-[12rem]"
        >
          <option value="all">All collectors</option>
          {collectors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.full_name || c.id.slice(0, 8)}
            </option>
          ))}
        </select>
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
      <div className="ml-auto">
        <ExportButton rows={exportRows} filename={exportName} sheet="Production" label="Export report" />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "recovered" | "gold" | "risk" | "secured";
}) {
  const color =
    accent === "recovered"
      ? "text-recovered"
      : accent === "gold"
        ? "text-gold"
        : accent === "risk"
          ? "text-risk"
          : accent === "secured"
            ? "text-secured"
            : "text-surface-ink";
  return (
    <div className="card p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-surface-muted">
        {label}
      </div>
      <div className={`font-display text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function AttainmentBadge({ pct }: { pct: number }) {
  const p = Math.round(pct * 100);
  let cls = "bg-risk/12 text-risk";
  if (p >= 100) cls = "bg-recovered/15 text-recovered";
  else if (p >= 75) cls = "bg-gold/15 text-gold";
  return <span className={`badge ${cls} font-mono`}>{p}%</span>;
}
