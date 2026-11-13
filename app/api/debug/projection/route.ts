import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/supabase/page";
import { payerBucket } from "@/lib/payer";

// Management-only diagnostic for the Projected Revenue tab. Figures out which
// bridge between payments and claims is viable (member id vs patient name) and
// which charge source is usable (payments vs claims vs billed_claims).
export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Order-independent name key: "INTELLI, MELISSA" and "Melissa Intelli" → "INTELLIMELISSA".
function nameKey(s: unknown): string {
  const m = String(s ?? "").toUpperCase().match(/[A-Z]+/g);
  return m ? m.sort().join("") : "";
}

export async function GET(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "management") return NextResponse.json({ error: "Management only" }, { status: 403 });

  const admin = createAdminClient();
  const facParam = new URL(request.url).searchParams.get("facility")?.toLowerCase() ?? "";
  const { data: facs } = await admin.from("facilities").select("id,name,short_name");
  const facilities = ((facs as any[]) ?? []);
  const match = (fid: string) => {
    if (!facParam) return true;
    const f = facilities.find((x) => x.id === fid);
    return `${f?.name ?? ""} ${f?.short_name ?? ""}`.toLowerCase().includes(facParam);
  };

  const claims = (await selectAll<any>((f, t) =>
    admin.from("claims").select("facility_id,patient_name,member_id,balance,charge_amount,claim_status,present").eq("present", true).range(f, t)
  )).filter((c) => match(c.facility_id));
  const pays = (await selectAll<any>((f, t) =>
    admin.from("payments").select("facility_id,patient_name,paid_amount").range(f, t)
  )).filter((p) => match(p.facility_id));
  const billed = (await selectAll<any>((f, t) =>
    admin.from("billed_claims").select("facility_id,patient_name,total_amount,payer_name").range(f, t)
  )).filter((b) => match(b.facility_id));

  // One-patient drill-down: ?patient=SPECK — shows exactly why a claim projects
  // the way it does (bridged paid, billed, claim charge, both candidate rates).
  const patientParam = new URL(request.url).searchParams.get("patient") ?? "";
  if (patientParam) {
    const want = patientParam.toUpperCase().match(/[A-Z]+/g)?.sort().join("") ?? "";
    const matchName = (s: unknown) => {
      const k = String(s ?? "").toUpperCase().match(/[A-Z]+/g)?.sort().join("") ?? "";
      return k && (k === want || k.includes(want) || want.includes(k));
    };
    const cs = claims.filter((c) => matchName(c.patient_name));
    const ps = pays.filter((p) => matchName(p.patient_name));
    const bs = billed.filter((b) => matchName(b.patient_name));
    const paidSum = ps.reduce((s, p) => s + (Number(p.paid_amount) || 0), 0);
    const billedSum = bs.reduce((s, b) => s + (Number(b.total_amount) || 0), 0);
    const chargeSum = cs.reduce((s, c) => s + (Number(c.charge_amount) || 0), 0);
    const balanceSum = cs.reduce((s, c) => s + (Number(c.balance) || 0), 0);
    const patientRate = billedSum > 0 ? +(paidSum / billedSum).toFixed(3) : null;
    return NextResponse.json({
      patient: patientParam,
      openClaims: cs.map((c) => ({ charge: c.charge_amount, balance: c.balance, status: c.claim_status, payer: payerBucket(c.claim_status) })),
      paymentLines: ps.length,
      paidSum: Math.round(paidSum),
      billedLines: bs.length,
      billedSum: Math.round(billedSum),
      openChargeSum: Math.round(chargeSum),
      openBalanceSum: Math.round(balanceSum),
      patientRate_paidOverBilled: patientRate,
      wouldUsePatientRate: billedSum >= 2000 && paidSum <= billedSum,
      note: "If wouldUsePatientRate is false, the claim falls back to the payer rate. patientRate × openBalance ≈ the Expected $ you'd see.",
    });
  }

  // Patient → payer family, from the open claims.
  const patientPayer = new Map<string, string>();
  const claimNames = new Set<string>();
  for (const c of claims) {
    const k = nameKey(c.patient_name);
    if (!k) continue;
    claimNames.add(k);
    if (!patientPayer.has(k)) patientPayer.set(k, payerBucket(c.claim_status));
  }

  // Payments: patient-name coverage + paid bridged to a payer via the claim patient.
  const payNames = new Set<string>();
  let payWithName = 0, payNameMatched = 0, paidMatched = 0, paidTotal = 0;
  const paidByPayer: Record<string, number> = {};
  for (const p of pays) {
    const paid = Number(p.paid_amount) || 0;
    paidTotal += paid;
    const k = nameKey(p.patient_name);
    if (k) { payWithName++; payNames.add(k); }
    if (k && patientPayer.has(k)) {
      payNameMatched++; paidMatched += paid;
      const b = patientPayer.get(k)!;
      paidByPayer[b] = (paidByPayer[b] ?? 0) + paid;
    }
  }

  // Charge sources by payer: open claims, and billed_claims.
  const claimChargeByPayer: Record<string, number> = {};
  const claimBalanceByPayer: Record<string, number> = {};
  for (const c of claims) {
    const b = payerBucket(c.claim_status);
    claimChargeByPayer[b] = (claimChargeByPayer[b] ?? 0) + (Number(c.charge_amount) || 0);
    claimBalanceByPayer[b] = (claimBalanceByPayer[b] ?? 0) + (Number(c.balance) || 0);
  }
  const billedByPayer: Record<string, number> = {};
  let billedWithAmount = 0, billedNameMatched = 0;
  const billedNames = new Set<string>();
  for (const b of billed) {
    const amt = Number(b.total_amount) || 0;
    if (amt > 0) billedWithAmount++;
    const k = nameKey(b.patient_name);
    if (k) billedNames.add(k);
    if (k && claimNames.has(k)) billedNameMatched++;
    // Payer from billed payer_name, else the patient's claim payer.
    const payer = payerBucket(b.payer_name) !== "Other" ? payerBucket(b.payer_name) : (patientPayer.get(k) ?? "Other");
    billedByPayer[payer] = (billedByPayer[payer] ?? 0) + amt;
  }

  // Candidate payer collection rates (paid bridged by name ÷ charge source).
  const buckets = Array.from(new Set([...Object.keys(paidByPayer), ...Object.keys(claimChargeByPayer), ...Object.keys(billedByPayer)]));
  const rates: Record<string, any> = {};
  for (const b of buckets) {
    const paid = paidByPayer[b] ?? 0;
    const billedAmt = billedByPayer[b] ?? 0;
    const claimCharge = claimChargeByPayer[b] ?? 0;
    rates[b] = {
      paid: Math.round(paid),
      billedCharge: Math.round(billedAmt),
      openCharge: Math.round(claimCharge),
      rate_vs_billed: billedAmt > 0 ? +(paid / billedAmt).toFixed(3) : null,
      rate_vs_openCharge: claimCharge > 0 ? +(paid / claimCharge).toFixed(3) : null,
    };
  }

  return NextResponse.json({
    scope: facParam || "all facilities",
    bridge: {
      claims_present: claims.length,
      distinct_claim_patients: claimNames.size,
      payments_total: pays.length,
      payments_with_patient_name: payWithName,
      payments_name_matched_to_a_claim_patient: payNameMatched,
      paid_total: Math.round(paidTotal),
      paid_matched_to_a_claim_patient: Math.round(paidMatched),
      paid_match_pct: paidTotal > 0 ? Math.round((paidMatched / paidTotal) * 100) : 0,
    },
    billed_claims: {
      total: billed.length,
      with_total_amount: billedWithAmount,
      distinct_patients: billedNames.size,
      name_matched_to_a_claim_patient: billedNameMatched,
    },
    candidate_payer_rates: rates,
    reading:
      "rate_vs_billed is the real collection rate (paid bridged by patient name ÷ billed_claims charges). rate_vs_openCharge uses open-claim charges as the denominator (will overstate). Pick whichever has coverage.",
  });
}
