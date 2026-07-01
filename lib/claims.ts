// Member-ID prefixes whose claims are excluded from AR totals and the collector
// Queue (e.g. a plan that BC Billing doesn't work). Add more prefixes here to
// exclude them everywhere at once.
export const EXCLUDED_MEMBER_PREFIXES = ["VMAH"] as const;

// True when a member id should be excluded from AR / the Queue.
export function isExcludedMember(memberId: unknown): boolean {
  const id = String(memberId ?? "").trim().toUpperCase();
  if (!id) return false;
  return EXCLUDED_MEMBER_PREFIXES.some((p) => id.startsWith(p));
}
