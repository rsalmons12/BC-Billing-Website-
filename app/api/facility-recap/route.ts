import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { easternToday, sendResend } from "@/lib/report/eodSummary";
import {
  computeFacilityRecaps,
  facilityRecipients,
  renderFacilityRecap,
} from "@/lib/report/facilityRecap";

// Manual "send now" for the facility daily recap. Management only.
//   test: true  -> a PREVIEW of every facility's recap goes to the caller only,
//                  so you can see exactly what each facility gets before any
//                  customer is emailed. No facility receives anything.
//   test: false -> each facility is emailed its own recap (its login email).
export const dynamic = "force-dynamic";

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

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Notifications need SUPABASE_SERVICE_ROLE_KEY set on the server." },
      { status: 503 }
    );
  }

  let body: { test?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    /* no body is fine */
  }

  const date = easternToday();
  const recaps = await computeFacilityRecaps(admin);

  // PREVIEW: send the caller ONE email with every facility's recap stacked, so
  // nothing reaches a customer. Great for verifying content and delivery.
  if (body.test) {
    const to = [user.email ?? ""].filter((e) => e.includes("@"));
    if (to.length === 0)
      return NextResponse.json({ error: "Your account has no email to preview to." }, { status: 400 });
    const html =
      `<div style="font-family:Arial,sans-serif;font-size:13px;color:#555;padding:10px 0">` +
      `<b>PREVIEW</b> — this is what each facility would receive. No facility was emailed.</div>` +
      recaps
        .map(
          (r) =>
            `<div style="border:1px solid #ddd;border-radius:10px;padding:14px;margin:0 0 18px">${renderFacilityRecap(
              r,
              date
            )}</div>`
        )
        .join("");
    try {
      await sendResend(to, `[PREVIEW] Facility daily recaps — ${recaps.length} facilities (${date})`, html);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "send failed" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, preview: true, facilities: recaps.length, recipients: to.length });
  }

  // REAL: each facility gets its own recap to its own login email.
  const recipients = await facilityRecipients(admin);
  let sent = 0;
  const skipped: string[] = [];
  for (const r of recaps) {
    const to = recipients.get(r.facilityId);
    if (!to || to.length === 0) {
      skipped.push(r.name);
      continue;
    }
    try {
      await sendResend(to, `${r.name} — Daily Recap (${date})`, renderFacilityRecap(r, date));
      sent++;
    } catch {
      skipped.push(r.name);
    }
  }
  return NextResponse.json({ ok: true, sent, skipped });
}
