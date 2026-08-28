import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendResend } from "@/lib/report/eodSummary";
import { logCronRun } from "@/lib/report/cronLog";
import { resolveInvoiceRecipients } from "@/lib/report/invoiceRecipients";
import { createSquarePaymentLink } from "@/lib/square";
import { money } from "@/lib/format";

// Daily: email a reminder for any UNPAID invoice at 7, 14, and 30 days after it
// was sent, then stop. Idempotent — each milestone is sent at most once (tracked
// by invoices.reminders_sent), so it's safe to fire more than once a day.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(ym: string): string {
  const m = ym?.match(/^(\d{4})-(\d{2})$/);
  return m ? `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : ym;
}
const DAY = 86400000;
// Which reminder milestone is due given days elapsed: 3 = 30d, 2 = 14d, 1 = 7d.
function dueMilestone(days: number): number {
  if (days >= 30) return 3;
  if (days >= 14) return 2;
  if (days >= 7) return 1;
  return 0;
}

export async function GET(request: Request) {
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Service role not configured." }, { status: 503 });
  }

  const secret = process.env.CRON_SECRET;
  const authOk = !secret || request.headers.get("authorization") === `Bearer ${secret}`;
  await logCronRun(admin, "invoice-reminders", `invoked (auth ${authOk ? "ok" : "FAIL"})`);
  if (!authOk) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!process.env.RESEND_API_KEY)
    return NextResponse.json({ error: "Email not configured." }, { status: 503 });

  const { data: rows } = await admin
    .from("invoices")
    .select("id, facility_id, period, amount, sent_at, reminders_sent")
    .eq("paid", false)
    .lt("reminders_sent", 3);
  const invoices = (rows ?? []) as {
    id: string;
    facility_id: string;
    period: string;
    amount: number;
    sent_at: string;
    reminders_sent: number;
  }[];

  const now = Date.now();
  let sent = 0;
  let advanced = 0;
  const skipped: string[] = [];

  // Facility details (name + static Square link) for the invoices in play.
  const facIds = Array.from(new Set(invoices.map((i) => i.facility_id)));
  const facById = new Map<string, { name: string; short_name: string | null; square_pay_url: string | null }>();
  if (facIds.length) {
    const { data: facs } = await admin
      .from("facilities")
      .select("id, name, short_name, square_pay_url")
      .in("id", facIds);
    for (const f of (facs ?? []) as any[])
      facById.set(f.id, { name: f.name, short_name: f.short_name, square_pay_url: f.square_pay_url });
  }

  for (const inv of invoices) {
    const days = Math.floor((now - Date.parse(inv.sent_at)) / DAY);
    const target = dueMilestone(days);
    if (target <= inv.reminders_sent) continue; // nothing new due yet

    const fac = facById.get(inv.facility_id);
    const facilityName = fac?.short_name || fac?.name || "Facility";
    const label = monthLabel(inv.period);
    const amount = Number(inv.amount) || 0;

    let to: string[] = [];
    let bcc: string[] = [];
    try {
      ({ to, bcc } = await resolveInvoiceRecipients(inv.facility_id, admin));
    } catch {
      /* recipient lookup failed — leave for a later run */
      skipped.push(`${facilityName} (recipient lookup)`);
      continue;
    }
    if (to.length === 0 && bcc.length) {
      to = bcc;
      bcc = [];
    }
    if (to.length === 0) {
      // No one to remind — advance the milestone so we don't retry forever.
      await admin
        .from("invoices")
        .update({ reminders_sent: target, last_reminder_at: new Date().toISOString() })
        .eq("id", inv.id);
      advanced++;
      skipped.push(`${facilityName} (no recipient)`);
      continue;
    }

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

    const nth = target === 1 ? "7-day" : target === 2 ? "14-day" : "30-day";
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
      <p style="font-size:11px;color:#888">Automated payment reminder from BC Billing.</p>
    </div>`;

    try {
      await sendResend(to, `Reminder — ${label} Invoice Still Due — ${facilityName}`, html, bcc);
      await admin
        .from("invoices")
        .update({ reminders_sent: target, last_reminder_at: new Date().toISOString() })
        .eq("id", inv.id);
      sent++;
    } catch (e) {
      skipped.push(`${facilityName} (send: ${e instanceof Error ? e.message : "failed"})`);
    }
  }

  await logCronRun(
    admin,
    "invoice-reminders",
    `done — sent ${sent}, advanced ${advanced}, skipped ${skipped.length}`
  );
  return NextResponse.json({ ok: true, sent, advanced, skipped });
}
