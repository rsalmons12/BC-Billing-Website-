import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/page";
import { buildRates } from "@/lib/projection";

// Builds the Projected Revenue rate table server-side (payment history is far too
// large to pull into the browser). Collection rates = paid ÷ billed, bridged by
// patient name. Returns a compact table (per payer + per patient). Honors the
// caller's RLS; management/staff only.
export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  // Management, staff, and facility logins may all build projections. RLS scopes
  // the underlying payments/billed/claims to what each caller is allowed to see.
  if (!me || !["management", "staff", "facility"].includes(me.role)) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const fid = new URL(request.url).searchParams.get("facility") ?? "all";
  const scoped = fid && fid !== "all";

  const payments = await selectAll<any>((f, t) => {
    let q = supabase.from("payments").select("patient_name,paid_amount,facility_id");
    if (scoped) q = q.eq("facility_id", fid);
    return q.range(f, t);
  });
  const billed = await selectAll<any>((f, t) => {
    let q = supabase.from("billed_claims").select("patient_name,total_amount,payer_name,facility_id");
    if (scoped) q = q.eq("facility_id", fid);
    return q.range(f, t);
  });
  const claims = await selectAll<any>((f, t) => {
    let q = supabase.from("claims").select("patient_name,claim_status,balance,facility_id").eq("present", true);
    if (scoped) q = q.eq("facility_id", fid);
    return q.range(f, t);
  });

  return NextResponse.json(buildRates(payments, billed, claims));
}
