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

// Payers whose marketplace / exchange plans carry a high risk of
// non-reimbursement. AR tied to these is flagged on the facility screen.
export const RISK_PAYER_PATTERNS: RegExp[] = [
  /highmark/i,
  /capital\s*(blue|bcbs)?/i, // Capital Blue Cross / Capital BCBS
  /independence/i, // Independence Blue Cross
];

// True when a payer name (or a claim-status string that names the payer, e.g.
// "Denied at Highmark") matches a non-reimbursement-risk payer.
export function isRiskPayer(text: unknown): boolean {
  const s = String(text ?? "");
  if (!s) return false;
  return RISK_PAYER_PATTERNS.some((p) => p.test(s));
}
