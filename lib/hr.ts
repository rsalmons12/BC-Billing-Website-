// Shared helpers for the HR & Compliance portal.

// Days until a date; negative = already past. null when there's no/invalid date.
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (isNaN(t)) return null;
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86400000);
}

export type ExpiryTone = "expired" | "soon" | "ok" | "none";

// "soon" = expires within soonDays (default 60).
export function expiryTone(iso: string | null | undefined, soonDays = 60): ExpiryTone {
  const d = daysUntil(iso);
  if (d == null) return "none";
  if (d < 0) return "expired";
  if (d <= soonDays) return "soon";
  return "ok";
}

export const EXPIRY_CLASS: Record<ExpiryTone, string> = {
  expired: "text-risk font-semibold",
  soon: "text-gold font-semibold",
  ok: "text-surface-ink",
  none: "text-surface-muted",
};

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  return isNaN(t) ? "—" : new Date(t).toLocaleDateString("en-US");
}

// US states for the license/credential pickers.
export const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
];
