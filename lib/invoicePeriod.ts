// Invoice billing periods. A normal monthly invoice uses period "YYYY-MM". A
// mid-month split uses a suffix: "YYYY-MM-H1" (the 1st–15th) or "YYYY-MM-H2"
// (the 16th–end). Keeping the halves as distinct period keys lets both live in
// the invoice ledger (which is unique per facility+period) without overwriting
// each other, and never double-bills — each half only counts its own days.

export type Half = 1 | 2 | null;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Build a ledger period key from a month + optional half.
export function makePeriod(month: string, half: Half): string {
  return half === 1 || half === 2 ? `${month}-H${half}` : month;
}

// Split a stored period back into its month and half.
export function splitPeriod(period: string): { month: string; half: Half } {
  const m = /^(\d{4}-\d{2})(?:-H([12]))?$/.exec(period ?? "");
  if (!m) return { month: period ?? "", half: null };
  return { month: m[1], half: m[2] ? (Number(m[2]) as 1 | 2) : null };
}

// Short label for a half window, e.g. "1st–15th".
export function halfLabel(half: Half): string {
  return half === 1 ? "1st–15th" : half === 2 ? "16th–end" : "";
}

// "Sep 2026" or "Sep 2026 (1st–15th)".
export function periodLabel(period: string): string {
  const { month, half } = splitPeriod(period);
  const mm = /^(\d{4})-(\d{2})$/.exec(month);
  const base = mm ? `${MONTHS[Number(mm[2]) - 1] ?? mm[2]} ${mm[1]}` : month;
  return half ? `${base} (${halfLabel(half)})` : base;
}

// "September 2026" or "September 2026 (1st–15th)" — for email subjects.
export function periodFull(period: string): string {
  const { month, half } = splitPeriod(period);
  const mm = /^(\d{4})-(\d{2})$/.exec(month);
  const base = mm ? `${MONTHS_FULL[Number(mm[2]) - 1] ?? mm[2]} ${mm[1]}` : month;
  return half ? `${base} (${halfLabel(half)})` : base;
}

// Day-of-month (1–31) from a date string like "9/12/2026" or "2026-09-12".
export function dayOfMonth(dateStr: unknown): number | null {
  const s = String(dateStr ?? "").trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s); // ISO
  if (m) return Number(m[3]);
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(s); // M/D/Y
  if (m) return Number(m[2]);
  const t = Date.parse(s);
  return isNaN(t) ? null : new Date(t).getDate();
}

// Whether a payment (by its day-of-month) belongs to the given half. A payment
// with no readable day is counted at month-end (half 2) so nothing is dropped.
export function inHalf(day: number | null, half: Half): boolean {
  if (!half) return true;
  if (day == null) return half === 2;
  return half === 1 ? day <= 15 : day >= 16;
}
