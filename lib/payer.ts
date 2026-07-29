// ---------------------------------------------------------------------------
// Payer classification — bucket a claim's status / payer text into a canonical
// payer family (BCBS, Aetna, Cigna, …) so every tab can filter by payer.
// Claim statuses look like "CLAIM AT BCBS OF NJ", "DENIED AT AETNA", etc.; the
// payer name is whatever follows " at ", but we normalize spelling variants
// (Blue Cross / Highmark / Horizon BCBS → BCBS, UHC → United, …) into families.
// ---------------------------------------------------------------------------

// The canonical families we offer as filter options, in display order.
export const PAYER_BUCKETS = [
  "BCBS",
  "Aetna",
  "Cigna",
  "United",
  "Humana",
  "Horizon",
  "Medicare",
  "Medicaid",
  "Tricare",
  "Other",
] as const;

export type PayerBucket = (typeof PAYER_BUCKETS)[number];

// Pull the payer portion out of a status like "Denied at Aetna" (everything
// after the last " at "); otherwise use the whole string.
function payerText(raw: unknown): string {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  const m = t.match(/\bat\s+(.+)$/i);
  return (m ? m[1] : t).trim();
}

// Classify any payer/status text into one of the PAYER_BUCKETS.
export function payerBucket(raw: unknown): PayerBucket {
  const s = payerText(raw).toLowerCase();
  if (!s) return "Other";
  // Blue family first (Horizon/Highmark/Anthem/Independence/Capital are all Blue).
  if (
    /bcbs|blue\s*cross|blue\s*shield|bluecard|blue\s*card|\bhorizon\b|highmark|anthem|independence|capital blue|carefirst|empire|\bbcn\b|regence|wellmark|premera|\bbc\b/.test(
      s
    )
  )
    return "BCBS";
  if (/aetna/.test(s)) return "Aetna";
  if (/cigna|evernorth/.test(s)) return "Cigna";
  if (/united|\buhc\b|optum|umr|oxford|golden rule/.test(s)) return "United";
  if (/humana/.test(s)) return "Humana";
  if (/medicare/.test(s)) return "Medicare";
  if (/medicaid|medi-cal|amerigroup|wellcare|molina|meridian/.test(s)) return "Medicaid";
  if (/tricare|champva/.test(s)) return "Tricare";
  return "Other";
}

// Does a status/payer text match the selected bucket ("all" matches everything)?
export function matchesPayer(raw: unknown, bucket: string): boolean {
  return bucket === "all" || payerBucket(raw) === bucket;
}
