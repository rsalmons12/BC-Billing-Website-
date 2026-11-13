import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/supabase/page";
import { payerBucket } from "@/lib/payer";
import { normMember } from "@/lib/projection";

// Management-only diagnostic for the Projected Revenue tab. Explains why claims
// do or don't project: payment charge coverage, member-id overlap between
// payments and open claims, and payer-bucket coverage on each side. Counts and
// totals only — no PHI beyond what the app already shows management.
export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

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
    const s = `${f?.name ?? ""} ${f?.short_name ?? ""}`.toLowerCase();
    return s.includes(facParam);
  };

  const claims = await selectAll<any>((f, t) =>
    admin.from("claims").select("facility_id,member_id,balance,claim_status,present").eq("present", true).range(f, t)
  );
  const pays = await selectAll<any>((f, t) =>
    admin.from("payments").select("facility_id,member_id,payment_source,charge_amount,paid_amount").range(f, t)
  );

  const C = claims.filter((c) => match(c.facility_id));
  const P = pays.filter((p) => match(p.facility_id));

  // Member overlap.
  const payMembers = new Set<string>();
  for (const p of P) { const m = normMember(p.member_id); if (m) payMembers.add(m); }
  let claimsWithMember = 0, claimsMemberMatched = 0;
  for (const c of C) { const m = normMember(c.member_id); if (m) { claimsWithMember++; if (payMembers.has(m)) claimsMemberMatched++; } }

  // Payment charge coverage + payer buckets.
  let payWithCharge = 0, payWithPaid = 0;
  const payByBucket: Record<string, { n: number; paid: number; chargePos: number }> = {};
  for (const p of P) {
    const charge = Number(p.charge_amount) || 0;
    const paid = Number(p.paid_amount) || 0;
    if (charge > 0) payWithCharge++;
    if (paid > 0) payWithPaid++;
    const b = payerBucket(p.payment_source);
    const e = (payByBucket[b] ??= { n: 0, paid: 0, chargePos: 0 });
    e.n++; e.paid += paid; if (charge > 0) e.chargePos += charge;
  }

  // Claim payer buckets + whether that bucket has usable payment charge.
  const claimByBucket: Record<string, { n: number; balance: number; payerHasCharge: boolean }> = {};
  for (const c of C) {
    const b = payerBucket(c.claim_status);
    const e = (claimByBucket[b] ??= { n: 0, balance: 0, payerHasCharge: false });
    e.n++; e.balance += Number(c.balance) || 0;
    e.payerHasCharge = (payByBucket[b]?.chargePos ?? 0) > 0;
  }

  return NextResponse.json({
    scope: facParam || "all facilities",
    claims: {
      presentTotal: C.length,
      withMemberId: claimsWithMember,
      memberMatchedToAPayment: claimsMemberMatched,
      byPayerBucket: claimByBucket,
    },
    payments: {
      total: P.length,
      withPaidAmount: payWithPaid,
      withChargeAmount: payWithCharge,
      distinctMemberIds: payMembers.size,
      byPayerBucket: payByBucket,
    },
    reading: {
      memberRateUsable: payWithCharge > 0 && claimsMemberMatched > 0,
      anyPayerChargeCoverage: payWithCharge > 0,
      note:
        payWithCharge === 0
          ? "No payment rows carry a charge amount, so paid÷charge cannot be computed from payments. Rate must use a different basis."
          : "Payments carry charge; check member overlap and payer-bucket coverage above for blanks.",
    },
  });
}
