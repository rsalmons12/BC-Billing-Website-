// ---------------------------------------------------------------------------
// Projected revenue — historical collection rates (paid ÷ charged) built from a
// facility's uploaded payment history, applied to open claim balances.
//   rate source:  the member's own history first; if the member has little/no
//                 history, the claim's payer family; if neither, no projection.
// ---------------------------------------------------------------------------
import { payerBucket } from "@/lib/payer";

export type RateAgg = { charge: number; paid: number };
export type RateBook = { member: Map<string, RateAgg>; payer: Map<string, RateAgg> };
export type ProjectionSource = "member" | "payer" | "none";
export type ClaimProjection = { expected: number; rate: number | null; source: ProjectionSource };

// Need at least this much member charge history before trusting the member's own
// rate — otherwise a single tiny line could swing a big balance. Falls back to payer.
export const MIN_MEMBER_CHARGE = 200;

// Normalize a member id for matching across the claims and payments tables.
export function normMember(s: unknown): string {
  return String(s ?? "").trim().toUpperCase().replace(/[\s-]/g, "");
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// A payment row only needs these fields to contribute to the rate book.
export type PayLike = {
  member_id: string | null;
  payment_source: string | null;
  charge_amount: number | null;
  paid_amount: number | null;
};

// Build member + payer collection-rate aggregates from payment history.
export function buildRateBook(pays: PayLike[]): RateBook {
  const member = new Map<string, RateAgg>();
  const payer = new Map<string, RateAgg>();
  for (const p of pays) {
    const charge = Number(p.charge_amount) || 0;
    const paid = Number(p.paid_amount) || 0;
    if (charge <= 0 && paid <= 0) continue;
    const mk = normMember(p.member_id);
    if (mk) {
      const e = member.get(mk) ?? { charge: 0, paid: 0 };
      e.charge += charge;
      e.paid += paid;
      member.set(mk, e);
    }
    const pk = payerBucket(p.payment_source);
    const e2 = payer.get(pk) ?? { charge: 0, paid: 0 };
    e2.charge += charge;
    e2.paid += paid;
    payer.set(pk, e2);
  }
  return { member, payer };
}

// A claim only needs these fields to be projected.
export type ClaimLike = {
  balance: number | null;
  member_id: string | null;
  claim_status: string | null;
};

// Expected revenue for one open claim: open balance × historical rate. Member's
// own paid÷charged first (if they have enough history), then the payer family,
// else no projection.
export function projectClaim(r: ClaimLike, book: RateBook | null): ClaimProjection {
  if (!book) return { expected: 0, rate: null, source: "none" };
  const bal = Number(r.balance) || 0;
  const mk = normMember(r.member_id);
  const m = mk ? book.member.get(mk) : undefined;
  if (m && m.charge >= MIN_MEMBER_CHARGE) {
    const rate = clamp01(m.paid / m.charge);
    return { expected: bal * rate, rate, source: "member" };
  }
  const p = book.payer.get(payerBucket(r.claim_status));
  if (p && p.charge > 0) {
    const rate = clamp01(p.paid / p.charge);
    return { expected: bal * rate, rate, source: "payer" };
  }
  return { expected: 0, rate: null, source: "none" };
}
