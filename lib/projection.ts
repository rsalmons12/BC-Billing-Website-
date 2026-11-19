// ---------------------------------------------------------------------------
// Projected revenue — real collection rates (paid ÷ billed) bridged by PATIENT
// NAME, because this data's payments carry no member id / charge and their
// payment_source doesn't classify to a payer. Charges come from billed_claims.
//   rate source:  the patient's own paid÷billed first; else the payer family's
//                 paid÷billed; else no projection.
// ---------------------------------------------------------------------------
import { payerBucket } from "@/lib/payer";

// Order-independent patient key: "INTELLI, MELISSA" and "Melissa Intelli" both
// → "INTELLIMELISSA". Bridges the differing name formats across tables.
export function nameKey(s: unknown): string {
  const m = String(s ?? "").toUpperCase().match(/[A-Z]+/g);
  return m ? m.sort().join("") : "";
}

// A patient needs at least this much billed history before we trust their own
// rate; below it we use the payer-family rate.
export const MIN_PATIENT_BILLED = 2000;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// Row shapes the rate builder needs (server-side).
export type PayRow = { patient_name: string | null; paid_amount: number | null };
export type BilledRow = { patient_name: string | null; total_amount: number | null; payer_name: string | null };
export type ClaimPayerRow = { patient_name: string | null; claim_status: string | null; balance: number | null };

// Compact, client-safe rate table (small: one entry per payer + per patient).
export type PayerBreakdownRow = { payer: string; paid: number; billed: number; rate: number };
export type ProjectionRates = {
  payerRate: Record<string, number>; // payer bucket -> collection rate (paid ÷ billed)
  patientRate: Record<string, number>; // patient name-key -> collection rate
  payerBreakdown: PayerBreakdownRow[];
  meta: { payments: number; billed: number; paidMatchedPct: number };
};

// Incremental accumulator so callers can stream rows in (one page at a time)
// instead of holding the whole payments table (140k+ rows) in memory at once.
//
// Collection rate = paid ÷ RESOLVED billed, where resolved billed = total billed
// minus the amount still sitting in open claims. Open claims haven't had a chance
// to pay yet, so including them in the denominator understates the rate badly
// (a patient billed $175k with $120k still open and $16k collected is at ~29% on
// resolved work, not 9% on everything ever billed).
export function createRateAccumulator() {
  const patientPayer = new Map<string, string>();
  const openBalByPatient = new Map<string, number>();
  const paidByPatient = new Map<string, number>();
  const billedByPatient = new Map<string, number>();
  const billedPayerByPatient = new Map<string, string>();
  let paidTotal = 0;
  let payCount = 0;
  let billedCount = 0;

  return {
    addClaim(c: ClaimPayerRow) {
      const k = nameKey(c.patient_name);
      if (!k) return;
      if (!patientPayer.has(k)) patientPayer.set(k, payerBucket(c.claim_status));
      openBalByPatient.set(k, (openBalByPatient.get(k) ?? 0) + (Number(c.balance) || 0));
    },
    addBilled(b: BilledRow) {
      billedCount++;
      const k = nameKey(b.patient_name);
      if (!k) return;
      billedByPatient.set(k, (billedByPatient.get(k) ?? 0) + (Number(b.total_amount) || 0));
      const pb = payerBucket(b.payer_name);
      if (pb !== "Other" && !billedPayerByPatient.has(k)) billedPayerByPatient.set(k, pb);
    },
    addPayment(p: PayRow) {
      payCount++;
      const paid = Number(p.paid_amount) || 0;
      paidTotal += paid;
      const k = nameKey(p.patient_name);
      if (!k) return;
      paidByPatient.set(k, (paidByPatient.get(k) ?? 0) + paid);
    },
    finalize(): ProjectionRates {
      const patientRate: Record<string, number> = {};
      const payerPaid = new Map<string, number>();
      const payerResolvedBilled = new Map<string, number>();
      let paidMatched = 0;
      const everyPatient = new Set([...billedByPatient.keys(), ...paidByPatient.keys()]);
      for (const k of everyPatient) {
        const paidP = paidByPatient.get(k) ?? 0;
        const billedP = billedByPatient.get(k) ?? 0;
        const openP = openBalByPatient.get(k) ?? 0;
        if (patientPayer.has(k)) paidMatched += paidP;
        const resolvedBilled = Math.max(0, billedP - openP); // exclude in-flight open claims
        const payer = patientPayer.get(k) ?? billedPayerByPatient.get(k) ?? "Other";
        if (resolvedBilled > 0) {
          payerPaid.set(payer, (payerPaid.get(payer) ?? 0) + paidP);
          payerResolvedBilled.set(payer, (payerResolvedBilled.get(payer) ?? 0) + resolvedBilled);
          if (resolvedBilled >= MIN_PATIENT_BILLED && paidP <= resolvedBilled) {
            patientRate[k] = clamp01(paidP / resolvedBilled);
          }
        }
      }
      const payerRate: Record<string, number> = {};
      const payerBreakdown: PayerBreakdownRow[] = [];
      for (const payer of new Set([...payerPaid.keys(), ...payerResolvedBilled.keys()])) {
        const paid = payerPaid.get(payer) ?? 0;
        const b = payerResolvedBilled.get(payer) ?? 0;
        const rate = b > 0 ? clamp01(paid / b) : 0;
        payerRate[payer] = rate;
        payerBreakdown.push({ payer, paid: Math.round(paid), billed: Math.round(b), rate });
      }
      payerBreakdown.sort((a, b) => b.paid - a.paid);
      return {
        payerRate,
        patientRate,
        payerBreakdown,
        meta: {
          payments: payCount,
          billed: billedCount,
          paidMatchedPct: paidTotal > 0 ? Math.round((paidMatched / paidTotal) * 100) : 0,
        },
      };
    },
  };
}

// Array convenience wrapper (used where the data is already in memory / small).
export function buildRates(
  payments: PayRow[],
  billed: BilledRow[],
  claims: ClaimPayerRow[]
): ProjectionRates {
  const acc = createRateAccumulator();
  for (const c of claims) acc.addClaim(c);
  for (const b of billed) acc.addBilled(b);
  for (const p of payments) acc.addPayment(p);
  return acc.finalize();
}

// A claim only needs these fields to be projected.
export type ClaimLike = {
  balance: number | null;
  patient_name: string | null;
  claim_status: string | null;
};
export type ProjectionSource = "patient" | "payer" | "none";
export type ClaimProjection = { expected: number; rate: number | null; source: ProjectionSource };

// Expected revenue for one open claim: open balance × collection rate. The
// patient's own paid÷billed first, then the payer family, else no projection.
export function projectClaim(c: ClaimLike, rates: ProjectionRates | null): ClaimProjection {
  if (!rates) return { expected: 0, rate: null, source: "none" };
  const bal = Number(c.balance) || 0;
  const k = nameKey(c.patient_name);
  if (k && k in rates.patientRate) {
    const r = rates.patientRate[k];
    return { expected: bal * r, rate: r, source: "patient" };
  }
  const payer = payerBucket(c.claim_status);
  if (payer in rates.payerRate) {
    const r = rates.payerRate[payer];
    return { expected: bal * r, rate: r, source: "payer" };
  }
  return { expected: 0, rate: null, source: "none" };
}
