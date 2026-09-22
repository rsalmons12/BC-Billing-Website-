import type { CensusWeekSummary } from "@/lib/report/census";

const money0 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

type CensusRow = { level_of_care?: string | null; paid_amount?: number | null };

// PHP / IOP / OP counts from the week's census rows (IOP checked before OP).
function locMix(rows: CensusRow[]) {
  let PHP = 0,
    IOP = 0,
    OP = 0,
    other = 0;
  for (const r of rows) {
    const s = String(r.level_of_care ?? "").toLowerCase();
    if (s.includes("php")) PHP++;
    else if (s.includes("iop")) IOP++;
    else if (s.includes("op")) OP++;
    else other++;
  }
  return { PHP, IOP, OP, other };
}

// Reimbursement mix: share of the census reimbursing over $1,000/day.
function payMix(rows: CensusRow[]) {
  let total = 0;
  let over1000 = 0;
  for (const r of rows) {
    total++;
    const paid = typeof r.paid_amount === "number" ? r.paid_amount : Number(r.paid_amount) || 0;
    if (paid > 1000) over1000++;
  }
  return { total, over1000, pct: total > 0 ? Math.round((over1000 / total) * 100) : 0 };
}

// A short, SMS-friendly census summary for one facility's current week. Includes
// client count, levels of care (PHP/IOP/OP), reimbursement mix (% over
// $1,000/day), missed groups, and expected revenue. e.g.:
//   "Summit Ridge — Census wk of Sep 8: 21 clients · 4 PHP/11 IOP/1 OP ·
//    71% >$1k/day · 4 missed GN (−$5,760) · Exp $61,200. Full recap in the app."
export function censusSmsBody(
  name: string,
  cur: CensusWeekSummary,
  weekRows: CensusRow[] = []
): string {
  const parts: string[] = [];
  parts.push(`${cur.patients} client${cur.patients === 1 ? "" : "s"}`);

  // Levels of care
  const loc = locMix(weekRows);
  const locBits: string[] = [];
  if (loc.PHP) locBits.push(`${loc.PHP} PHP`);
  if (loc.IOP) locBits.push(`${loc.IOP} IOP`);
  if (loc.OP) locBits.push(`${loc.OP} OP`);
  if (loc.other) locBits.push(`${loc.other} other`);
  if (locBits.length) parts.push(locBits.join("/"));

  // Reimbursement mix
  const pm = payMix(weekRows);
  if (pm.total > 0) parts.push(`${pm.pct}% >$1k/day`);

  // Missed groups + expected revenue
  const missedGN = cur.missedGroups ?? 0;
  if (missedGN > 0) parts.push(`${missedGN} missed GN (−${money0(cur.missedRev)})`);
  if (cur.expected > 0) parts.push(`Exp ${money0(cur.expected)}`);

  return `${name} — Census wk of ${cur.weekLabel}: ${parts.join(" · ")}. Full recap in the app.`;
}
