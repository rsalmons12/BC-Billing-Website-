import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/supabase/page";
import { periodOf } from "@/lib/import/parseTrackers";
import { sendResend } from "@/lib/report/eodSummary";
import { money } from "@/lib/format";

// Email a facility's monthly invoice (fee = collected × the facility's rate) to
// the users marked "receives invoices" in Admin. Management only. Amounts are
// recomputed server-side so the emailed figure is authoritative.
export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(ym: string): string {
  const m = ym.match(/^(\d{4})-(\d{2})$/);
  return m ? `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : ym;
}

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "management")
    return NextResponse.json({ error: "Management only." }, { status: 403 });

  if (!process.env.RESEND_API_KEY)
    return NextResponse.json({ error: "Email is not configured (RESEND_API_KEY missing)." }, { status: 503 });

  let body: { facilityId?: string; month?: string; test?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    /* handled below */
  }
  if (!body.facilityId || !body.month)
    return NextResponse.json({ error: "Missing facility or month." }, { status: 400 });

  const { data: fac } = await supabase
    .from("facilities")
    .select("name, short_name, billing_rate")
    .eq("id", body.facilityId)
    .maybeSingle();
  if (!fac) return NextResponse.json({ error: "Facility not found." }, { status: 404 });
  const rate = fac.billing_rate;
  if (rate == null || rate <= 0)
    return NextResponse.json(
      { error: `No billing rate set for ${fac.short_name || fac.name}. Set a Bill % in Admin → Facilities.` },
      { status: 400 }
    );

  // Recompute collections for the month from payments (deposit → entered → period).
  const pays = await selectAll<{
    paid_amount: number | null;
    deposit_date: string | null;
    payment_entered: string | null;
    period: string | null;
  }>((f, t) =>
    supabase
      .from("payments")
      .select("paid_amount,deposit_date,payment_entered,period")
      .eq("facility_id", body.facilityId)
      .range(f, t)
  ).catch(() => []);
  const collected = pays
    .filter((p) => periodOf(p.deposit_date ?? "", p.payment_entered ?? "", p.period ?? "") === body.month)
    .reduce((s, p) => s + (p.paid_amount ?? 0), 0);
  const fee = Math.round(collected * (rate / 100) * 100) / 100;
  const facilityName = fac.short_name || fac.name;
  const label = monthLabel(body.month);

  // Recipients: a test goes to the caller; otherwise the users flagged
  // "receives invoices" in Admin.
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Notifications need SUPABASE_SERVICE_ROLE_KEY set on the server." },
      { status: 503 }
    );
  }
  let to: string[];
  if (body.test) {
    to = [user.email ?? ""].filter((e) => e.includes("@"));
  } else {
    const { data: flagged } = await admin.from("profiles").select("id").eq("receives_invoices", true);
    const ids = (flagged ?? []).map((p: { id: string }) => p.id);
    const emails: string[] = [];
    for (const id of ids) {
      try {
        const { data } = await admin.auth.admin.getUserById(id);
        if (data?.user?.email) emails.push(data.user.email);
      } catch {
        /* skip */
      }
    }
    to = Array.from(new Set(emails));
  }
  if (to.length === 0)
    return NextResponse.json(
      {
        error: body.test
          ? "Your account has no email."
          : "No users are marked to receive invoices. Check 'Invoices' for someone in Admin → Users.",
      },
      { status: 400 }
    );

  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6">
    <h2 style="margin:0 0 2px">Invoice — ${facilityName}</h2>
    <p style="margin:0 0 14px;color:#555">Service period: ${label}</p>
    <table style="border-collapse:collapse;width:100%;max-width:520px;font-size:14px">
      <tbody>
        <tr><td style="padding:6px 8px;border-bottom:1px solid #eee">Collections (${label})</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${money(collected)}</td></tr>
        <tr><td style="padding:6px 8px;border-bottom:1px solid #eee">Rate</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${rate}%</td></tr>
        <tr><td style="padding:8px;font-weight:700">Amount Due</td>
            <td style="padding:8px;font-weight:700;text-align:right;color:#137333">${money(fee)}</td></tr>
      </tbody>
    </table>
    <p style="font-size:12px;color:#777;margin-top:12px">Fee is ${rate}% of collections received in ${label}.</p>
    <hr style="border:none;border-top:1px solid #ddd;margin-top:16px" />
    <p style="font-size:11px;color:#888">Automated invoice from BC Billing.</p>
  </div>`;

  try {
    await sendResend(to, `${body.test ? "[TEST] " : ""}Invoice — ${facilityName} · ${label} · ${money(fee)}`, html);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "send failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, recipients: to.length, fee, collected, test: !!body.test });
}
