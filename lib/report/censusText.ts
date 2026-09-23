import type { FacilityRecap } from "@/lib/report/facilityRecap";

const money0 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// Patient initials only — never a real name in the text (it travels by SMS). Both
// "First Last" and "Last, First" collapse to first-initial + last-initial (e.g.
// "Alice Brown" and "Brown, Alice" → "AB").
function initials(name: unknown): string {
  const s = String(name ?? "").trim();
  if (!s) return "—";
  let first = "";
  let last = "";
  if (s.includes(",")) {
    const [l, f] = s.split(",").map((x) => x.trim());
    last = l ?? "";
    first = f ?? "";
  } else {
    const parts = s.split(/\s+/).filter(Boolean);
    first = parts[0] ?? "";
    last = parts.length > 1 ? parts[parts.length - 1] : "";
  }
  const out = `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
  return out || (s[0] ?? "").toUpperCase();
}

// The weekly census text for one facility, built from its recap so the numbers
// match the Census page exactly (levels of care, the full reimbursement mix,
// missed groups, expected revenue, and expected revenue on outstanding claims).
// Returns "" when the facility has no current census week (caller skips it).
export function censusSmsBody(recap: FacilityRecap): string {
  // Reported = last completed week (prior), matching the recap's census fields.
  const cur = recap.census?.prior ?? recap.census?.current;
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
    const rev = cur.missedRev > 0 ? ` (−${money0(cur.missedRev)})` : "";
    lines.push(`Missed groups: ${cur.missedGroups}${rev}`);
  }
  // Overview dollars (full month-to-date), matching the dashboard.
  lines.push(`Total Billed (this month): ${money0(recap.billedMonth)}`);
  lines.push(`Total Collected (this month): ${money0(recap.collectedMonth)}`);
  lines.push(`Collection Rate: ${Math.round(recap.collectionRate * 100)}%`);
  lines.push(`Total Outstanding (AR): ${money0(recap.totalAR)}`);

  // Per-patient outstanding claims, like the daily recap's "Expected Revenue on
  // Outstanding Claims" table: patient — level, per-day rate × outstanding lines.
  if (recap.censusReceivables.length) {
    lines.push("");
    lines.push("Outstanding claims by patient:");
    for (const r of recap.censusReceivables) {
      lines.push(
        `${initials(r.patient)} — ${r.loc}, ${money0(r.perDay)}/day x ${r.outstanding} ${r.loc} = ${money0(
          r.expected
        )}`
      );
    }
    lines.push(`Total expected on outstanding claims: ${money0(censusExpected)}`);
  }

  lines.push("Full recap in the app.");

  return lines.join("\n");
}
