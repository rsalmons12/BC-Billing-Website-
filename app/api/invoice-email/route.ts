import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/supabase/page";
import { periodOf } from "@/lib/import/parseTrackers";
import { sendResend } from "@/lib/report/eodSummary";
import { buildMonthlyBundle } from "@/lib/report/monthlyBundle";
import { createSquarePaymentLink } from "@/lib/square";
import { money } from "@/lib/format";
import type { Payment, BilledClaim, Claim, Negotiation } from "@/lib/types";

// Email a facility's monthly invoice (fee = collected × the facility's rate) to
// the users marked "receives invoices" in Admin. Management only. Amounts are
// recomputed server-side so the emailed figure is authoritative.
export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
function monthLabel(ym: string): string {
  const m = ym.match(/^(\d{4})-(\d{2})$/);
  return m ? `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : ym;
}
// Full month name (e.g. "July 2026") for the subject line.
function monthFull(ym: string): string {
  const m = ym.match(/^(\d{4})-(\d{2})$/);
  return m ? `${MONTHS_FULL[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : ym;
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

  let body: { facilityId?: string; month?: string; test?: boolean; dryRun?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    /* handled below */
  }
  if (!body.facilityId || !body.month)
    return NextResponse.json({ error: "Missing facility or month." }, { status: 400 });

  const { data: fac } = await supabase
    .from("facilities")
    .select("name, short_name, billing_rate, square_pay_url")
    .eq("id", body.facilityId)
    .maybeSingle();
  if (!fac) return NextResponse.json({ error: "Facility not found." }, { status: 404 });
  const rate = fac.billing_rate;
  if (rate == null || rate <= 0)
    return NextResponse.json(
      { error: `No billing rate set for ${fac.short_name || fac.name}. Set a Bill % in Admin → Facilities.` },
      { status: 400 }
    );

  // Recipients: THIS facility's own login(s) get the invoice (To), and the
  // internal users marked "Invoices" (management/staff) are BCC'd on it. A
  // facility can therefore only ever receive its OWN invoice — never another's.
  const resolveRecipients = async (): Promise<{ to: string[]; bcc: string[] }> => {
    const admin = createAdminClient();
    if (body.test) return { to: [user.email ?? ""].filter((e) => e.includes("@")), bcc: [] };

    const emailsOf = async (ids: string[]): Promise<string[]> => {
      const out: string[] = [];
      for (const id of ids) {
        try {
          const { data } = await admin.auth.admin.getUserById(id);
          if (data?.user?.email) out.push(data.user.email);
        } catch {
          /* skip */
        }
      }
      return Array.from(new Set(out));
    };

    const [{ data: facProfs }, { data: asgs }, { data: internal }] = await Promise.all([
      // Facility users marked "Invoices" → each gets ITS OWN facility's invoice.
      admin
        .from("profiles")
        .select("id, facility_id")
        .eq("role", "facility")
        .eq("receives_invoices", true),
      admin.from("assignments").select("profile_id, facility_id"),
      // Internal (non-facility) users marked "Invoices" → BCC copies on all.
      admin.from("profiles").select("id").eq("receives_invoices", true).neq("role", "facility"),
    ]);

    // Marked facility users for THIS facility (primary facility_id or assignment).
    const facIds = new Set((facProfs ?? []).map((p: { id: string }) => p.id));
    const facLogins = new Set<string>();
    for (const p of (facProfs ?? []) as { id: string; facility_id: string | null }[])
      if (p.facility_id === body.facilityId) facLogins.add(p.id);
    for (const a of (asgs ?? []) as { profile_id: string; facility_id: string | null }[])
      if (a.facility_id === body.facilityId && facIds.has(a.profile_id)) facLogins.add(a.profile_id);

    const to = await emailsOf(Array.from(facLogins));
    const bccAll = await emailsOf(((internal ?? []) as { id: string }[]).map((p) => p.id));
    const bcc = bccAll.filter((e) => !to.includes(e));
    return { to, bcc };
  };

  // DRY RUN: return exactly who would receive it (To + BCC) — no email sent — so
  // the button shows the recipient list and confirms first.
  if (body.dryRun) {
    let rcpt: { to: string[]; bcc: string[] };
    try {
      rcpt = await resolveRecipients();
    } catch {
      return NextResponse.json(
        { error: "Notifications need SUPABASE_SERVICE_ROLE_KEY set on the server." },
        { status: 503 }
      );
    }
    let diag = "";
    if (rcpt.to.length === 0 && rcpt.bcc.length === 0)
      diag = `No one is marked "Invoices" for ${fac.short_name || fac.name}. In Admin → Users, check "Invoices" on ${fac.short_name || fac.name}'s login (and any management to copy). If you did check it, run the receives_invoices migration in Supabase so it saves.`;
    return NextResponse.json({ ok: true, dryRun: true, to: rcpt.to, bcc: rcpt.bcc, diag });
  }

  // Pull the facility's data for the report bundle (attached to the email).
  const safe = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);
  const [pays, billed, claims, negotiations] = await Promise.all([
    safe(
      selectAll<Payment>((f, t) =>
        supabase.from("payments").select("*").eq("facility_id", body.facilityId).range(f, t)
      )
    ),
    safe(
      selectAll<BilledClaim>((f, t) =>
        supabase.from("billed_claims").select("*").eq("facility_id", body.facilityId).range(f, t)
      )
    ),
    safe(
      selectAll<Claim>((f, t) =>
        supabase
          .from("claims")
          .select("*")
          .eq("facility_id", body.facilityId)
          .eq("present", true)
          .range(f, t)
      )
    ),
    safe(
      selectAll<Negotiation>((f, t) =>
        supabase.from("negotiations").select("*").eq("facility_id", body.facilityId).range(f, t)
      )
    ),
  ]);

  const payMonth = (p: Payment) => periodOf(p.deposit_date ?? "", p.payment_entered ?? "", p.period ?? "");
  const bilMonth = (b: BilledClaim) => b.period || periodOf(b.entered_date ?? "");
  const monthPayments = pays.filter((p) => payMonth(p) === body.month);
  const monthBilled = billed.filter((b) => bilMonth(b) === body.month);
  const collected = monthPayments.reduce((s, p) => s + (p.paid_amount ?? 0), 0);
  const fee = Math.round(collected * (rate / 100) * 100) / 100;
  const facilityName = fac.short_name || fac.name;
  const label = monthLabel(body.month);

  // Build the monthly report bundle (with the INVOICE sheet) to attach.
  let attachment: { filename: string; content: string } | null = null;
  try {
    const buf = await buildMonthlyBundle({
      facilityName,
      monthLabel: label,
      payments: monthPayments,
      billed: monthBilled,
      claims,
      negotiations,
      billingRate: rate,
      invoiceDate: monthFull(body.month),
    });
    attachment = {
      filename: `${facilityName}_${body.month}_Monthly_Report.xlsx`.replace(/[^\w.-]+/g, "_"),
      content: Buffer.from(new Uint8Array(buf)).toString("base64"),
    };
  } catch {
    /* if the bundle fails, still send the invoice email without the attachment */
  }

  // Recipients: this facility's login(s) as To, internal "Invoices" users as BCC.
  let to: string[];
  let bcc: string[];
  try {
    ({ to, bcc } = await resolveRecipients());
  } catch {
    return NextResponse.json(
      { error: "Notifications need SUPABASE_SERVICE_ROLE_KEY set on the server." },
      { status: 503 }
    );
  }
  // If the facility has no login, send to the internal copies as To instead.
  if (to.length === 0 && bcc.length) {
    to = bcc;
    bcc = [];
  }
  if (to.length === 0)
    return NextResponse.json(
      {
        error: body.test
          ? "Your account has no email."
          : `${facilityName} has no login, and no internal user is marked "Invoices" to send to.`,
      },
      { status: 400 }
    );

  // Payment link: prefer an EXACT-amount Square link (needs the Square token);
  // otherwise fall back to the facility's static Square link.
  const staticUrl =
    typeof fac.square_pay_url === "string" && /^https?:\/\//i.test(fac.square_pay_url.trim())
      ? fac.square_pay_url.trim()
      : null;
  let payUrl: string | null = staticUrl;
  let payExact = false;
  const square = await createSquarePaymentLink({
    amount: fee,
    name: `${facilityName} — ${label} Invoice`,
  });
  if (square.url) {
    payUrl = square.url;
    payExact = true;
  }

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
    ${
      payUrl
        ? `<p style="margin:16px 0 4px">
             <a href="${payUrl}" style="display:inline-block;background:#006aff;color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:8px">Pay ${payExact ? money(fee) + " " : ""}via Square</a>
           </p>
           <p style="font-size:11px;color:#999;margin:0">${payExact ? `Secure Square checkout for ${money(fee)}.` : "Secure payment through Square."}</p>`
        : ""
    }
    ${
      attachment
        ? `<p style="font-size:13px;color:#333;margin-top:10px">📎 The full ${label} monthly report is attached (Excel).</p>`
        : ""
    }
    <hr style="border:none;border-top:1px solid #ddd;margin-top:16px" />
    <p style="font-size:11px;color:#888">Automated invoice from BC Billing.</p>
  </div>`;

  try {
    await sendResend(
      to,
      `${body.test ? "[TEST] " : ""}${monthFull(body.month)} Monthly Reporting and Invoice — ${facilityName}`,
      html,
      bcc,
      attachment ? [attachment] : undefined
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "send failed" }, { status: 502 });
  }
  return NextResponse.json({
    ok: true,
    recipients: to.length + bcc.length,
    sentTo: to,
    bcc,
    fee,
    collected,
    test: !!body.test,
    // Why the Square "Pay" button did / didn't appear, so misconfig is visible.
    squarePay: payExact ? "exact-link" : staticUrl ? "static-link" : "none",
    squareError: square.url ? null : square.error,
  });
}
