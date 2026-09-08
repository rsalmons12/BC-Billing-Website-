import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendResend } from "@/lib/report/eodSummary";
import { resolveInvoiceRecipients } from "@/lib/report/invoiceRecipients";
import { createSquarePaymentLink } from "@/lib/square";
import { money } from "@/lib/format";

// Manually send a payment reminder for ONE invoice, right now — the owner's
// "Send reminder" button. The 7/14/30-day cron still runs on its own; this just
// lets the owner nudge a facility on demand. Owner-only. Records the send in
// last_reminder_at but leaves the automatic milestone clock alone.
export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(ym: string): string {
  const m = ym?.match(/^(\d{4})-(\d{2})$/);
  return m ? `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : ym;
}

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: me } = await supabase
    .from("profiles")
    .select("role, is_owner")
    .eq("id", user.id)
    .maybeSingle();
  // Reminders are owner-only, same as invoicing.
  if (me?.role !== "management" || me?.is_owner !== true)
    return NextResponse.json({ error: "Owners only." }, { status: 403 });

  if (!process.env.RESEND_API_KEY)
    return NextResponse.json({ error: "Email is not configured (RESEND_API_KEY missing)." }, { status: 503 });

  let body: { invoiceId?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* handled below */
  }
  if (!body.invoiceId) return NextResponse.json({ error: "Missing invoice." }, { status: 400 });

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Reminders need SUPABASE_SERVICE_ROLE_KEY set on the server." },
      { status: 503 }
    );
  }

  const { data: inv } = await admin
    .from("invoices")
    .select("id, facility_id, period, amount, paid")
    .eq("id", body.invoiceId)
    .maybeSingle();
  if (!inv) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  if (inv.paid) return NextResponse.json({ error: "That invoice is already marked paid." }, { status: 400 });

  const { data: fac } = await admin
    .from("facilities")
    .select("name, short_name, square_pay_url")
    .eq("id", inv.facility_id)
    .maybeSingle();
  const facilityName = fac?.short_name || fac?.name || "Facility";
  const label = monthLabel(inv.period);
  const amount = Number(inv.amount) || 0;

  let to: string[] = [];
  let bcc: string[] = [];
  try {
    ({ to, bcc } = await resolveInvoiceRecipients(inv.facility_id, admin));
  } catch {
    return NextResponse.json({ error: "Couldn't look up who to remind." }, { status: 502 });
  }
  if (to.length === 0 && bcc.length) {
    to = bcc;
    bcc = [];
  }
  if (to.length === 0)
    return NextResponse.json(
      {
        error: `No one is marked "Invoices" for ${facilityName}. Check the facility's login in Admin → Users.`,
      },
      { status: 400 }
    );

  // Exact-amount Square link, else the facility's static link.
  const staticUrl =
    typeof fac?.square_pay_url === "string" && /^https?:\/\//i.test(fac.square_pay_url.trim())
      ? fac.square_pay_url.trim()
      : null;
  let payUrl: string | null = staticUrl;
  let payExact = false;
  if (amount > 0) {
    const sq = await createSquarePaymentLink({ amount, name: `${facilityName} — ${label} Invoice` });
    if (sq.url) {
      payUrl = sq.url;
      payExact = true;
    }
  }

  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6">
    <h2 style="margin:0 0 2px">Payment Reminder — ${facilityName}</h2>
    <p style="margin:0 0 14px;color:#555">Your ${label} invoice is still showing an outstanding balance.</p>
    <table style="border-collapse:collapse;width:100%;max-width:520px;font-size:14px">
      <tbody>
        <tr><td style="padding:8px;font-weight:700">Amount Due</td>
            <td style="padding:8px;font-weight:700;text-align:right;color:#b00020">${money(amount)}</td></tr>
      </tbody>
    </table>
    ${
      payUrl
        ? `<p style="margin:16px 0 4px">
             <a href="${payUrl}" style="display:inline-block;background:#006aff;color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:8px">Pay ${payExact ? money(amount) + " " : ""}via Square</a>
           </p>
           <p style="font-size:11px;color:#999;margin:0">${payExact ? `Secure Square checkout for ${money(amount)}.` : "Secure payment through Square."}</p>`
        : ""
    }
    <p style="font-size:12px;color:#777;margin-top:12px">If you've already paid, please disregard this reminder — thank you.</p>
    <hr style="border:none;border-top:1px solid #ddd;margin-top:16px" />
    <p style="font-size:11px;color:#888">Payment reminder from BC Billing.</p>
  </div>`;

  try {
    await sendResend(to, `Reminder — ${label} Invoice Still Due — ${facilityName}`, html, bcc);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "send failed" }, { status: 502 });
  }

  // Record the manual nudge without disturbing the automatic 7/14/30 schedule.
  try {
    await admin
      .from("invoices")
      .update({ last_reminder_at: new Date().toISOString() })
      .eq("id", inv.id);
  } catch {
    /* best-effort */
  }

  return NextResponse.json({ ok: true, sentTo: to, bcc, recipients: to.length + bcc.length });
}
