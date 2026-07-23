"use client";

import { useMemo, useState } from "react";
import { money } from "@/lib/format";
import type { FacilityOutlook, Direction } from "@/lib/report/moneyOutlook";

const DIR_META: Record<Direction, { icon: string; text: string; bg: string; word: string }> = {
  up: { icon: "▲", text: "text-recovered", bg: "bg-recovered/10", word: "improving" },
  down: { icon: "▼", text: "text-risk", bg: "bg-risk/10", word: "declining" },
  flat: { icon: "▬", text: "text-surface-muted", bg: "bg-surface", word: "holding" },
  risk: { icon: "⚠", text: "text-gold", bg: "bg-gold/10", word: "at risk" },
};

export default function MoneyOutlookPanel({ outlooks }: { outlooks: FacilityOutlook[] }) {
  const [sel, setSel] = useState<string>("all");
  const current = useMemo(
    () =>
      outlooks.find((o) => (sel === "all" ? o.facility_id === null : o.facility_id === sel)) ??
      outlooks[0],
    [outlooks, sel]
  );
  if (!current) return null;

  const dm = DIR_META[current.direction];

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border px-5 py-4">
        <div>
          <h2 className="font-display text-lg font-bold">Money Outlook</h2>
          <p className="text-sm text-surface-muted">
            Month-over-month forecast · {current.curLabel} vs {current.priorLabel}
          </p>
        </div>
        <select
          value={sel}
          onChange={(e) => setSel(e.target.value)}
          className="input max-w-[16rem]"
        >
          <option value="all">All facilities</option>
          {outlooks
            .filter((o) => o.facility_id)
            .map((o) => (
              <option key={o.facility_id!} value={o.facility_id!}>
                {o.facility_name}
              </option>
            ))}
        </select>
      </div>

      {/* headline */}
      <div className={`flex flex-wrap items-center gap-4 px-5 py-4 ${dm.bg}`}>
        <div className={`font-display text-3xl font-bold ${dm.text}`}>
          {dm.icon}{" "}
          {current.pct == null ? "New" : `${current.pct >= 0 ? "+" : ""}${current.pct.toFixed(0)}%`}
        </div>
        <div>
          <div className="text-sm font-semibold">
            Revenue {dm.word} · {money(current.paidCur)} collected in {current.curLabel}
          </div>
          <div className="text-xs text-surface-muted">
            vs {money(current.paidPrior)} in {current.priorLabel}
          </div>
        </div>
      </div>

      {/* one-line reason */}
      <p className="border-y border-surface-border bg-surface px-5 py-2 text-sm">
        {current.reason}
      </p>

      {/* driver cards */}
      <div className="grid gap-3 p-5 sm:grid-cols-2">
        {current.drivers.length === 0 && (
          <p className="text-sm text-surface-muted">
            Not enough data yet — import payments, billed claims, authorizations and census to power
            the forecast.
          </p>
        )}
        {current.drivers.map((d) => {
          const m = DIR_META[d.direction];
          return (
            <div key={d.key} className="rounded-xl border border-surface-border p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-semibold">{d.label}</span>
                <span className={`text-sm font-bold ${m.text}`}>{m.icon}</span>
              </div>
              <p className="text-xs text-surface-muted">{d.detail}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
