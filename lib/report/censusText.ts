import type { FacilityRecap } from "@/lib/report/facilityRecap";

const money0 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// The weekly census text for one facility, built from its recap so the numbers
// match the Census page exactly (levels of care, the full reimbursement mix,
// missed groups, expected revenue, and expected revenue on outstanding claims).
// Returns "" when the facility has no current census week (caller skips it).
export function censusSmsBody(recap: FacilityRecap): string {
  const cur = recap.census?.current;
  if (!cur) return "";

  const loc = recap.censusLocMix;
  const pm = recap.censusPayMix;
  const pct = (n: number) => (pm.total > 0 ? Math.round((n / pm.total) * 100) : 0);

  const locBits: string[] = [];
  if (loc.PHP) locBits.push(`${loc.PHP} PHP`);
  if (loc.IOP) locBits.push(`${loc.IOP} IOP`);
  if (loc.OP) locBits.push(`${loc.OP} OP`);
  if (loc.other) locBits.push(`${loc.other} other`);

  const censusExpected = recap.censusReceivables.reduce((s, r) => s + r.expected, 0);

  const lines: string[] = [];
  lines.push(`${recap.name} — Census (${cur.weekLabel})`);
  lines.push(
    `${cur.patients} client${cur.patients === 1 ? "" : "s"}${
      locBits.length ? ` — ${locBits.join(", ")}` : ""
    }`
  );
  lines.push(
    `Reimbursement mix: ${pct(pm.over1000)}% over $1,000/day, ${pct(pm.over2000)}% over $2,000/day, ${pct(
      pm.under800
    )}% under $800/day`
  );
  if ((cur.missedGroups ?? 0) > 0) {
    lines.push(`Missed groups: ${cur.missedGroups} (−${money0(cur.missedRev)})`);
  }
  if (cur.expected > 0) lines.push(`Expected revenue this week: ${money0(cur.expected)}`);
  if (censusExpected > 0) lines.push(`Expected on outstanding claims: ${money0(censusExpected)}`);
  lines.push("Full recap in the app.");

  return lines.join("\n");
}
