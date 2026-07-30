import { money } from "@/lib/format";
import type { CensusWeekSummary } from "@/lib/report/census";

// Current-week census per facility on the Overview: patients (current census),
// missed groups (GN), and missed revenue — always the most recent week, with
// the week shown per facility.
export default function CensusPanel({
  summaries,
  facName,
}: {
  summaries: CensusWeekSummary[];
  facName: (id: string) => string;
}) {
  if (summaries.length === 0) return null;

  const rows = [...summaries].sort((a, b) => b.missedRev - a.missedRev);
  const tot = rows.reduce(
    (s, r) => ({
      patients: s.patients + r.patients,
      missedGroups: s.missedGroups + r.missedGroups,
      missedRev: s.missedRev + r.missedRev,
    }),
    { patients: 0, missedGroups: 0, missedRev: 0 }
  );

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border px-5 py-3">
        <span className="font-semibold">Facility Census · current week</span>
        <span className="text-xs text-surface-muted">Most recent week per facility</span>
      </div>
      <div className="scroll-x overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface">
            <tr>
              <th className="th">Facility</th>
              <th className="th">Week</th>
              <th className="th text-right">Current Census (Patients)</th>
              <th className="th text-right">Missed Groups</th>
              <th className="th text-right">Missed Revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={r.facilityId} className={idx % 2 ? "bg-surface/40" : ""}>
                <td className="td font-medium">{facName(r.facilityId)}</td>
                <td className="td text-xs text-surface-muted">{r.weekLabel}</td>
                <td className="td text-right font-mono font-semibold">{r.patients}</td>
                <td className="td text-right">
                  {r.missedGroups > 0 ? (
                    <span className="font-bold text-risk">{r.missedGroups}</span>
                  ) : (
                    <span className="text-surface-muted">0</span>
                  )}
                </td>
                <td className="td text-right font-mono">
                  {r.missedRev > 0 ? (
                    <span className="font-semibold text-risk">{money(r.missedRev)}</span>
                  ) : (
                    <span className="text-surface-muted">{money(0)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-surface-border bg-surface font-semibold">
              <td className="td">Network total</td>
              <td className="td text-xs text-surface-muted">current week</td>
              <td className="td text-right font-mono">{tot.patients}</td>
              <td className="td text-right text-risk">{tot.missedGroups}</td>
              <td className="td text-right font-mono text-risk">{money(tot.missedRev)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
