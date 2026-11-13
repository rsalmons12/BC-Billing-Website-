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
export type ClaimPayerRow = { patient_name: string | null; claim_status: string | null };

// Compact, client-safe rate table (small: one entry per payer + per patient).
export type PayerBreakdownRow = { payer: string; paid: number; billed: number; rate: number };
export type ProjectionRates = {
  payerRate: Record<string, number>; // payer bucket -> collection rate (paid ÷ billed)
  patientRate: Record<string, number>; // patient name-key -> collection rate
  payerBreakdown: PayerBreakdownRow[];
  meta: { payments: number; billed: number; paidMatchedPct: number };
};

// Build the rate table from payment history, billed history, and open claims.
export function buildRates(
  payments: PayRow[],
  billed: BilledRow[],
  claims: ClaimPayerRow[]
): ProjectionRates {
  // Patient -> payer family, taken from the open claims (the payer we'll bill).
  const patientPayer = new Map<string, string>();
  for (const c of claims) {
    const k = nameKey(c.patient_name);
    if (k && !patientPayer.has(k)) patientPayer.set(k, payerBucket(c.claim_status));
  }
  const claimNames = new Set(patientPayer.keys());

  // Paid per patient (bridged by name) + match rate for the meta line.
  const paidByPatient = new Map<string, number>();
  let paidTotal = 0;
  let paidMatched = 0;
  for (const p of payments) {
    const paid = Number(p.paid_amount) || 0;
    paidTotal += paid;
    const k = nameKey(p.patient_name);
    if (!k) continue;
    paidByPatient.set(k, (paidByPatient.get(k) ?? 0) + paid);
    if (claimNames.has(k)) paidMatched += paid;
  }

  // Billed per patient (the charge denominator).
  const billedByPatient = new Map<string, number>();
  for (const b of billed) {
    const k = nameKey(b.patient_name);
    if (!k) continue;
    billedByPatient.set(k, (billedByPatient.get(k) ?? 0) + (Number(b.total_amount) || 0));
  }

  // Payer-level paid (bridged via the patient's payer) and billed (billed_claims'
  // own payer_name, falling back to the patient's claim payer).
  const paidByPayer = new Map<string, number>();
  for (const p of payments) {
    const payer = patientPayer.get(nameKey(p.patient_name));
    if (!payer) continue;
    paidByPayer.set(payer, (paidByPayer.get(payer) ?? 0) + (Number(p.paid_amount) || 0));
  }
  const billedByPayer = new Map<string, number>();
  for (const b of billed) {
    const k = nameKey(b.patient_name);
    const pb = payerBucket(b.payer_name);
    const payer = pb !== "Other" ? pb : patientPayer.get(k) ?? "Other";
    billedByPayer.set(payer, (billedByPayer.get(payer) ?? 0) + (Number(b.total_amount) || 0));
  }

  const payerRate: Record<string, number> = {};
  const payerBreakdown: PayerBreakdownRow[] = [];
  for (const payer of new Set([...paidByPayer.keys(), ...billedByPayer.keys()])) {
    const paid = paidByPayer.get(payer) ?? 0;
    const b = billedByPayer.get(payer) ?? 0;
    const rate = b > 0 ? clamp01(paid / b) : 0;
    payerRate[payer] = rate;
    payerBreakdown.push({ payer, paid: Math.round(paid), billed: Math.round(b), rate });
  }
  payerBreakdown.sort((a, b) => b.paid - a.paid);

  // Patient-level rates, only where there's enough billed history and the numbers
  // are sane (paid ≤ billed — otherwise billed history is incomplete, use payer).
  const patientRate: Record<string, number> = {};
  for (const [k, billedP] of billedByPatient) {
    if (billedP < MIN_PATIENT_BILLED) continue;
    const paidP = paidByPatient.get(k) ?? 0;
    if (paidP > billedP) continue;
    patientRate[k] = clamp01(paidP / billedP);
  }

  return {
    payerRate,
    patientRate,
    payerBreakdown,
    meta: {
      payments: payments.length,
      billed: billed.length,
      paidMatchedPct: paidTotal > 0 ? Math.round((paidMatched / paidTotal) * 100) : 0,
    },
  };
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
