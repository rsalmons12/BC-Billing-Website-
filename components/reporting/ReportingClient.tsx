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
type ResolvedRow = {
  claim_id: string;
  resolved_at: string | null; // timestamptz
  resolved_by: string | null;
};
type AnyRow = Record<string, unknown>;

type Dept = "collectors" | "repricing" | "negotiations" | "payments";

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
];

export default function ReportingClient({
  facilities,
  collectors,
}: {
  facilities: Facility[];
  collectors: Profile[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const today = todayStr();

  const [dept, setDept] = useState<Dept>("collectors");
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const [collectorFilter, setCollectorFilter] = useState("all");
  const [facilityFilter, setFacilityFilter] = useState("all");

  const [logs, setLogs] = useState<ProdRow[]>([]);
  const [resolved, setResolved] = useState<ResolvedRow[]>([]);
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
      const c = collectors.find((c) => c.id === id);
      return c?.full_name || c?.initials || (id ? id.slice(0, 8) : "—");
    },
    [collectors]
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
    const res = await selectAll<ResolvedRow>((f, t) =>
      supabase
        .from("claim_work")
        .select("claim_id,resolved_at,resolved_by")
        .eq("resolved", true)
        .gte("resolved_at", `${wideFrom}T00:00:00`)
        .range(f, t)
    );
    setLogs(prod);
    setResolved(res);
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
          resolved={resolved}
          loading={loading}
          facName={facName}
          colName={colName}
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
  resolved,
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
  resolved: ResolvedRow[];
  loading: boolean;
  facName: (id: string | null) => string;
  colName: (id: string | null) => string;
}) {
  const days = useMemo(() => dateRange(from, to), [from, to]);

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

  // closed-out within range (by collector; resolved rows carry no facility)
  const closedByCol = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of resolved) {
      const d = (r.resolved_at || "").slice(0, 10);
      if (!d || !inRange(d)) continue;
      if (collectorFilter !== "all" && r.resolved_by !== collectorFilter) continue;
      const id = r.resolved_by ?? "—";
      m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [resolved, inRange, collectorFilter]);

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
        closed: closedByCol.get(id) ?? 0,
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
  }, [ranged, collectors, colName, closedByCol]);

  const perDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of ranged) m.set(l.worked_on, (m.get(l.worked_on) ?? 0) + 1);
    return m;
  }, [ranged]);

  const grandTotal = ranged.length;
  const grandClosed = Array.from(closedByCol.values()).reduce((s, n) => s + n, 0);
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
          "Closed Out": r.closed,
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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Worked (range)" value={num(grandTotal)} accent="recovered" />
        <Stat label="Closed Out" value={num(grandClosed)} accent="gold" />
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
                {best.total} worked · {best.closed} closed · {Math.round(best.attainment * 100)}% of
                target · avg {Math.round(best.avg * 10) / 10}/day
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
          Worked” / “Close out” in their Queue, their activity shows up here.
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
                    <th className="th text-right">Closed</th>
                    <th className="th text-right">Days</th>
                    <th className="th text-right">Avg/Day</th>
                    <th className="th text-right">Best</th>
                    <th className="th text-right">Attainment</th>
                    <th className="th text-right">This Wk</th>
                    <th className="th text-right">Last Wk</th>
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
                        <td className="td text-right font-mono">{r.closed}</td>
                        <td className="td text-right font-mono">{r.daysActive}</td>
                        <td className="td text-right font-mono">{Math.round(r.avg * 10) / 10}</td>
                        <td className="td text-right font-mono">{r.best}</td>
                        <td className="td text-right">
                          <AttainmentBadge pct={r.attainment} />
                        </td>
                        <td className="td text-right font-mono">{w.tw}</td>
                        <td className="td text-right font-mono text-surface-muted">{w.lw}</td>
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
                    <td className="td text-right font-mono">{grandClosed}</td>
                    <td className="td" colSpan={6}></td>
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
    Exclude<Dept, "collectors">,
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
  const c = cfg[dept as Exclude<Dept, "collectors">];

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
  accent?: "recovered" | "gold" | "risk";
}) {
  const color =
    accent === "recovered"
      ? "text-recovered"
      : accent === "gold"
        ? "text-gold"
        : accent === "risk"
          ? "text-risk"
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
