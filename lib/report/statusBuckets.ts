import { statusAction, statusPayerName } from "@/lib/payer";

// ---------------------------------------------------------------------------
// Status buckets — group AR claims by payer + status action (e.g. "Horizon ·
// Claim At", "Aetna · Denied At", "User Print"), with the claim count, total
// outstanding balance, and the most recent date any claim in the bucket was
// worked. Powers the status breakdown on the daily recap and the Overview.
// ---------------------------------------------------------------------------

export interface StatusBucket {
  key: string; // stable identity, "payer|action"
  payer: string; // "Horizon" | "" when the status names no payer
  action: string; // "Claim At" | "Denied At" | "User Print" | "Rejected" | …
  label: string; // "Horizon · Claim At" or just "User Print"
  count: number; // how many claims in this bucket
  balance: number; // total outstanding $
  lastWorked: string | null; // most recent date_worked among these claims (raw)
}

type ClaimLike = {
  claim_id?: string | null;
  claim_status: string | null;
  balance: number | null;
};

// Build the buckets. `workedByClaim` maps claim_id → its date_worked (from
// claim_work); omit it and every bucket's lastWorked is null.
export function bucketByStatus(
  claims: ClaimLike[],
  workedByClaim?: Map<string, string>
): StatusBucket[] {
  const map = new Map<string, StatusBucket>();
  const bestMs = new Map<string, number>();
  for (const c of claims) {
    const action = statusAction(c.claim_status);
    if (!action) continue; // no status → nothing to bucket
    const payer = statusPayerName(c.claim_status);
    const key = `${payer}|${action}`;
    let b = map.get(key);
    if (!b) {
      b = {
        key,
        payer,
        action,
        label: payer ? `${payer} · ${action}` : action,
        count: 0,
        balance: 0,
        lastWorked: null,
      };
      map.set(key, b);
      bestMs.set(key, -Infinity);
    }
    b.count += 1;
    b.balance += c.balance ?? 0;
    const dw = c.claim_id ? workedByClaim?.get(c.claim_id) : undefined;
    if (dw) {
      const t = Date.parse(dw);
      if (!isNaN(t) && t > (bestMs.get(key) ?? -Infinity)) {
        bestMs.set(key, t);
        b.lastWorked = dw;
      }
    }
  }
  // Biggest balance first — that's where the money (and the follow-up) is.
  return Array.from(map.values()).sort((a, b) => b.balance - a.balance);
}

// "8/21" from a stored date (ISO or M/D/YYYY); "never" when no claim in the
// bucket has ever been worked.
export function lastWorkedLabel(raw: string | null): string {
  if (!raw) return "never";
  const t = Date.parse(raw);
  if (isNaN(t)) return raw;
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
