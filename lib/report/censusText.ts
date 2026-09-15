import type { CensusWeekSummary } from "@/lib/report/census";

const money0 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// A short, SMS-friendly census summary for one facility's current week. Kept
// under ~300 chars so it lands as one/two segments. e.g.:
//   "Summit Ridge — Census wk of Sep 8: 21 clients · 4 missed GN (−$5,760) ·
//    Expected $61,200. Full recap in the app."
export function censusSmsBody(name: string, cur: CensusWeekSummary): string {
  const missedGN = cur.missedGroups ?? 0;
  const parts: string[] = [];
  parts.push(`${cur.patients} client${cur.patients === 1 ? "" : "s"}`);
  if (missedGN > 0) parts.push(`${missedGN} missed GN (−${money0(cur.missedRev)})`);
  else parts.push("no missed groups");
  if (cur.expected > 0) parts.push(`Expected ${money0(cur.expected)}`);
  return `${name} — Census wk of ${cur.weekLabel}: ${parts.join(" · ")}. Full recap in the app.`;
}
