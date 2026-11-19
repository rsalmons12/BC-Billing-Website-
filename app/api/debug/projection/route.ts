import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { payerBucket } from "@/lib/payer";
import { createRateAccumulator } from "@/lib/projection";

// Management-only diagnostic for the Projected Revenue tab. Streams rows one page
// at a time (never holding the whole payments table in memory). Two modes:
//   • default: the compact rate table (per-payer breakdown + meta)
//   • ?patient=NAME: a one-patient drill-down (paid, billed, resolved rate)
export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

function nameKey(s: unknown): string {
  const m = String(s ?? "").toUpperCase().match(/[A-Z]+/g);
  return m ? m.sort().join("") : "";
}

const PAGE = 1000;
async function forEachRow<T>(
  make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  onRow: (r: T) => void
) {
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await make(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows) onRow(r);
    if (rows.length < PAGE) break;
  }
}

export async function GET(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "management") return NextResponse.json({ error: "Management only" }, { status: 403 });

  const admin = createAdminClient();
  const url = new URL(request.url);
  const facParam = url.searchParams.get("facility")?.toLowerCase() ?? "";
  const patientParam = url.searchParams.get("patient") ?? "";

  const { data: facs } = await admin.from("facilities").select("id,name,short_name");
  const facilities = ((facs as any[]) ?? []);
  const facIds = facParam
    ? new Set(
        facilities
          .filter((f) => `${f.name ?? ""} ${f.short_name ?? ""}`.toLowerCase().includes(facParam))
          .map((f) => f.id)
      )
    : null;
  const inScope = (fid: string) => !facIds || facIds.has(fid);

  // --- One-patient drill-down ---------------------------------------------
  if (patientParam) {
    const want = nameKey(patientParam);
    const matchName = (s: unknown) => {
      const k = nameKey(s);
      return k && (k === want || k.includes(want) || want.includes(k));
    };
    const openClaims: any[] = [];
    let paidSum = 0, billedSum = 0, paymentLines = 0, billedLines = 0, balanceSum = 0;
    await forEachRow<any>((f, t) =>
      admin.from("claims").select("facility_id,patient_name,balance,charge_amount,claim_status").eq("present", true).range(f, t)
    , (c) => {
      if (!inScope(c.facility_id) || !matchName(c.patient_name)) return;
      openClaims.push({ charge: c.charge_amount, balance: c.balance, status: c.claim_status, payer: payerBucket(c.claim_status) });
      balanceSum += Number(c.balance) || 0;
    });
    await forEachRow<any>((f, t) =>
      admin.from("payments").select("facility_id,patient_name,paid_amount").range(f, t)
    , (p) => { if (inScope(p.facility_id) && matchName(p.patient_name)) { paymentLines++; paidSum += Number(p.paid_amount) || 0; } });
    await forEachRow<any>((f, t) =>
      admin.from("billed_claims").select("facility_id,patient_name,total_amount").range(f, t)
    , (b) => { if (inScope(b.facility_id) && matchName(b.patient_name)) { billedLines++; billedSum += Number(b.total_amount) || 0; } });

    const resolvedBilled = Math.max(0, billedSum - balanceSum);
    const resolvedRate = resolvedBilled > 0 ? +(paidSum / resolvedBilled).toFixed(3) : null;
    return NextResponse.json({
      patient: patientParam,
      openClaims,
      paymentLines,
      paidSum: Math.round(paidSum),
      billedLines,
      billedSum: Math.round(billedSum),
      openBalanceSum: Math.round(balanceSum),
      resolvedBilled: Math.round(resolvedBilled),
      rate_paidOverAllBilled: billedSum > 0 ? +(paidSum / billedSum).toFixed(3) : null,
      rate_paidOverResolvedBilled: resolvedRate,
      wouldUsePatientRate: resolvedBilled >= 2000 && paidSum <= resolvedBilled,
      expectedOnOneClaim_example: resolvedRate != null && openClaims[0] ? Math.round((Number(openClaims[0].balance) || 0) * resolvedRate) : null,
      note: "The tab uses rate_paidOverResolvedBilled (open claims removed from the denominator) × each open balance.",
    });
  }

  // --- Compact rate table -------------------------------------------------
  const acc = createRateAccumulator();
  await forEachRow<any>((f, t) =>
    admin.from("claims").select("patient_name,claim_status,balance,facility_id").eq("present", true).range(f, t)
  , (c) => { if (inScope(c.facility_id)) acc.addClaim(c); });
  await forEachRow<any>((f, t) =>
    admin.from("billed_claims").select("patient_name,total_amount,payer_name,facility_id").range(f, t)
  , (b) => { if (inScope(b.facility_id)) acc.addBilled(b); });
  await forEachRow<any>((f, t) =>
    admin.from("payments").select("patient_name,paid_amount,facility_id").range(f, t)
  , (p) => { if (inScope(p.facility_id)) acc.addPayment(p); });

  const rates = acc.finalize();
  return NextResponse.json({
    scope: facParam || "all facilities",
    meta: rates.meta,
    payerBreakdown: rates.payerBreakdown,
    patientRatesCount: Object.keys(rates.patientRate).length,
    note: "payerBreakdown.rate = paid ÷ resolved billed. Add ?patient=NAME for a single-patient drill-down.",
  });
}
