"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import { num } from "@/lib/format";
import ExportButton, { type ExportRow } from "@/components/overview/ExportButton";
import type { Facility, Profile } from "@/lib/types";

type ProdRow = {
  id: string;
  collector_id: string | null;
  claim_id: string | null;
  facility_id: string | null;
  worked_on: string; // yyyy-mm-dd
};

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
  // guard against inverted ranges / runaway loops
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

export default function ReportingClient({
  facilities,
  collectors,
}: {
  facilities: Facility[];
  collectors: Profile[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const today = todayStr();

  const [from, setFrom] = useState(addDays(today, -6)); // last 7 days
  const [to, setTo] = useState(today);
  const [collectorFilter, setCollectorFilter] = useState("all");
  const [facilityFilter, setFacilityFilter] = useState("all");
  const [logs, setLogs] = useState<ProdRow[]>([]);
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

  const load = useCallback(async () => {
    setLoading(true);
    const rows = await selectAll<ProdRow>((f, t) =>
      supabase
        .from("production_log")
        .select("*")
        .gte("worked_on", from)
        .lte("worked_on", to)
        .range(f, t)
    );
    setLogs(rows);
    setLoading(false);
  }, [supabase, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const days = useMemo(() => dateRange(from, to), [from, to]);

  // Apply collector / facility filters.
  const filtered = useMemo(
    () =>
      logs.filter(
        (l) =>
          (collectorFilter === "all" || l.collector_id === collectorFilter) &&
          (facilityFilter === "all" || l.facility_id === facilityFilter)
      ),
    [logs, collectorFilter, facilityFilter]
  );

  // Per-collector aggregates.
  const perCollector = useMemo(() => {
    const map = new Map<
      string,
      { total: number; byDay: Map<string, number>; facs: Set<string> }
    >();
    for (const l of filtered) {
      const id = l.collector_id ?? "—";
      if (!map.has(id)) map.set(id, { total: 0, byDay: new Map(), facs: new Set() });
      const e = map.get(id)!;
      e.total += 1;
      e.byDay.set(l.worked_on, (e.byDay.get(l.worked_on) ?? 0) + 1);
      if (l.facility_id) e.facs.add(l.facility_id);
    }
    // Build rows for every collector that has any activity, sorted by total.
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
  }, [filtered, collectors, colName]);

  // Totals per day (all shown collectors).
  const perDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of filtered) m.set(l.worked_on, (m.get(l.worked_on) ?? 0) + 1);
    return m;
  }, [filtered]);

  // Per-facility totals.
  const perFacility = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of filtered) {
      const id = l.facility_id ?? "—";
      m.set(id, (m.get(id) ?? 0) + 1);
    }
    return Array.from(m.entries())
      .map(([id, n]) => ({ id, name: facName(id), n }))
      .sort((a, b) => b.n - a.n);
  }, [filtered, facName]);

  const grandTotal = filtered.length;
  const activeCollectors = perCollector.length;
  const bestDay = Math.max(0, ...Array.from(perDay.values()));
  const avgPerCollectorDay =
    activeCollectors && days.length
      ? grandTotal / activeCollectors / days.length
      : 0;
  const todayTotal = filtered.filter((l) => l.worked_on === today).length;

  // ---- Excel export (summary + daily matrix) ----
  const exportRows: ExportRow[] = useMemo(
    () =>
      perCollector.map((r) => {
        const base: ExportRow = {
          Collector: r.name,
          "Job Title": r.title,
          "Daily Target": r.target,
          "Total Worked": r.total,
          "Days Active": r.daysActive,
          "Avg / Day": Math.round(r.avg * 10) / 10,
          "Best Day": r.best,
          "Target Attainment %": Math.round(r.attainment * 100),
          Facilities: r.facs,
        };
        for (const d of days) base[weekdayLabel(d)] = r.byDay.get(d) ?? 0;
        return base;
      }),
    [perCollector, days]
  );

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
      {/* controls */}
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <span className="label">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <span className="label">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="input"
          />
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
          <ExportButton
            rows={exportRows}
            filename={`staff-production_${from}_to_${to}.xlsx`}
            sheet="Production"
            label="Export report"
          />
        </div>
      </div>

      {/* headline cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Worked (range)" value={num(grandTotal)} accent="recovered" />
        <Stat label="Worked Today" value={num(todayTotal)} accent="gold" />
        <Stat label="Active Collectors" value={num(activeCollectors)} />
        <Stat label="Avg / Collector / Day" value={(Math.round(avgPerCollectorDay * 10) / 10).toString()} />
        <Stat label="Best Single Day" value={num(bestDay)} />
      </div>

      {loading && (
        <div className="card p-10 text-center text-surface-muted">Loading production…</div>
      )}

      {!loading && grandTotal === 0 && (
        <div className="card p-10 text-center text-surface-muted">
          No production recorded in this range yet. As collectors mark claims
          “✓ Worked” in their Queue, their activity shows up here.
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
                    <th className="th text-right">Total</th>
                    <th className="th text-right">Days</th>
                    <th className="th text-right">Avg/Day</th>
                    <th className="th text-right">Best</th>
                    <th className="th text-right">Attainment</th>
                    <th className="th text-right">Facilities</th>
                  </tr>
                </thead>
                <tbody>
                  {perCollector.map((r, i) => (
                    <tr key={r.id} className={i % 2 ? "bg-surface/40" : ""}>
                      <td className="td font-medium">{r.name}</td>
                      <td className="td text-xs text-surface-muted">{r.title}</td>
                      <td className="td text-right font-mono">{r.target}</td>
                      <td className="td text-right font-mono font-semibold">{r.total}</td>
                      <td className="td text-right font-mono">{r.daysActive}</td>
                      <td className="td text-right font-mono">
                        {Math.round(r.avg * 10) / 10}
                      </td>
                      <td className="td text-right font-mono">{r.best}</td>
                      <td className="td text-right">
                        <AttainmentBadge pct={r.attainment} />
                      </td>
                      <td className="td text-right font-mono">{r.facs}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-surface-border bg-surface font-semibold">
                    <td className="td" colSpan={3}>
                      Total
                    </td>
                    <td className="td text-right font-mono">{grandTotal}</td>
                    <td className="td" colSpan={5}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* daily matrix */}
          <div className="card overflow-hidden">
            <div className="border-b border-surface-border px-4 py-3 font-semibold">
              Daily production grid
            </div>
            <div className="scroll-x overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface">
                  <tr>
                    <th className="th sticky left-0 z-10 bg-surface text-left">
                      Collector
                    </th>
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
                      <td className="td sticky left-0 z-10 bg-inherit font-medium">
                        {r.name}
                      </td>
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
                      <td className="td text-right font-mono font-semibold">
                        {r.total}
                      </td>
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

          {/* by facility */}
          <div className="card overflow-hidden">
            <div className="border-b border-surface-border px-4 py-3 font-semibold">
              Production by facility
            </div>
            <div className="scroll-x overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface">
                  <tr>
                    <th className="th text-left">Facility</th>
                    <th className="th text-right">Claims worked</th>
                    <th className="th text-right">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {perFacility.map((f, i) => (
                    <tr key={f.id} className={i % 2 ? "bg-surface/40" : ""}>
                      <td className="td font-medium">{f.name}</td>
                      <td className="td text-right font-mono">{f.n}</td>
                      <td className="td text-right font-mono text-surface-muted">
                        {grandTotal ? Math.round((f.n / grandTotal) * 100) : 0}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
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
  accent?: "recovered" | "gold";
}) {
  const color =
    accent === "recovered"
      ? "text-recovered"
      : accent === "gold"
        ? "text-gold"
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
