"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import { SumCard } from "@/components/trackers/TrackerModule";
import type { Profile } from "@/lib/types";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export default function TeamStatusClient({ collectors }: { collectors: Profile[] }) {
  const supabase = useMemo(() => createClient(), []);
  const today = todayStr();
  const [worked, setWorked] = useState<Record<string, number>>({});
  const [reserved, setReserved] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    // Worked today (from the production log) and reserved today (claim_work).
    const [prod, claimed] = await Promise.all([
      selectAll<{ collector_id: string }>((f, t) =>
        supabase
          .from("production_log")
          .select("collector_id")
          .eq("worked_on", today)
          .range(f, t)
      ),
      selectAll<{ claimed_by: string }>((f, t) =>
        supabase
          .from("claim_work")
          .select("claimed_by")
          .eq("claimed_at", today)
          .range(f, t)
      ),
    ]);
    const w: Record<string, number> = {};
    for (const p of prod) if (p.collector_id) w[p.collector_id] = (w[p.collector_id] ?? 0) + 1;
    const r: Record<string, number> = {};
    for (const c of claimed) if (c.claimed_by) r[c.claimed_by] = (r[c.claimed_by] ?? 0) + 1;
    setWorked(w);
    setReserved(r);
    setLoading(false);
    setRefreshedAt(new Date().toLocaleTimeString("en-US"));
  }, [supabase, today]);

  useEffect(() => {
    load();
    const id = setInterval(load, 20000); // auto-refresh so you can watch it live
    return () => clearInterval(id);
  }, [load]);

  const rows = useMemo(
    () =>
      collectors
        .map((c) => {
          const target = c.daily_target ?? 100;
          const done = worked[c.id] ?? 0;
          const held = reserved[c.id] ?? 0;
          return {
            id: c.id,
            name: c.full_name || c.initials || "Unnamed",
            title: c.job_title || "Collector",
            tier: c.queue_tier === "priority_100" ? "100+" : "0–99",
            target,
            done,
            held,
            pct: target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0,
          };
        })
        .sort((a, b) => b.done - a.done),
    [collectors, worked, reserved]
  );

  const totals = rows.reduce(
    (s, r) => ({ done: s.done + r.done, held: s.held + r.held }),
    { done: 0, held: 0 }
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-surface-border bg-surface-card px-6 py-3">
        <button onClick={load} className="btn-ghost text-xs">
          ↻ Refresh
        </button>
        <span className="text-xs text-surface-muted">
          Auto-refreshes every 20s{refreshedAt ? ` · last ${refreshedAt}` : ""}
        </span>
        <div className="ml-auto text-xs text-surface-muted">
          Today: <b className="text-surface-ink">{totals.done}</b> worked ·{" "}
          <b className="text-surface-ink">{totals.held}</b> reserved
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 border-b border-surface-border bg-surface px-6 py-3 md:grid-cols-3">
        <SumCard label="Collectors" value={String(collectors.length)} />
        <SumCard label="Worked today" value={String(totals.done)} accent="recovered" />
        <SumCard label="Reserved today" value={String(totals.held)} accent="gold" />
      </div>

      <div className="scroll-x min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              <th className="th">Collector</th>
              <th className="th">Job title</th>
              <th className="th">Tier</th>
              <th className="th text-right">Target</th>
              <th className="th text-right">Worked today</th>
              <th className="th text-right">Reserved today</th>
              <th className="th min-w-[10rem]">Progress</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="td py-10 text-center text-surface-muted">
                  Loading…
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.id} className={i % 2 ? "bg-surface/40" : "bg-surface-card"}>
                <td className="td font-medium">{r.name}</td>
                <td className="td text-xs text-surface-muted">{r.title}</td>
                <td className="td text-xs">
                  {r.tier === "100+" ? (
                    <span className="badge bg-risk/12 text-risk">100+</span>
                  ) : (
                    <span className="text-surface-muted">0–99</span>
                  )}
                </td>
                <td className="td text-right font-mono">{r.target}</td>
                <td className="td text-right font-mono font-semibold text-recovered">{r.done}</td>
                <td className="td text-right font-mono text-gold">{r.held}</td>
                <td className="td">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface">
                      <div
                        className="h-full rounded-full bg-recovered"
                        style={{ width: `${r.pct}%` }}
                      />
                    </div>
                    <span className="w-9 text-right text-xs text-surface-muted">{r.pct}%</span>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="td py-10 text-center text-surface-muted">
                  No collectors yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
