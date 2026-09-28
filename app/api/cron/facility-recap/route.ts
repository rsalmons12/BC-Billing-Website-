import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { easternToday, easternHour, isEasternFriday, sendResend, managementEmails } from "@/lib/report/eodSummary";
import {
  computeFacilityRecaps,
  facilityRecipients,
  renderFacilityRecap,
} from "@/lib/report/facilityRecap";

// Runs on a schedule (see vercel.json) — Friday ~5:30 PM Eastern — and emails
// each facility its own WEEKLY recap (the Overview picture, scoped to that
// facility) to that facility's login email. A facility only ever sees its data.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Weekly, Friday only. Fires at 21:00 AND 22:00 UTC; only the one at 5 PM
  // Eastern actually sends, so it stays at 5 PM ET across daylight-saving
  // changes. ?force=1 bypasses both the day and hour gates for a manual test.
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  if (!isEasternFriday() && !force)
    return NextResponse.json({ ok: true, sent: false, reason: "weekly recap sends Fridays only" });
  if (easternHour() !== 17 && !force)
    return NextResponse.json({ ok: true, sent: false, reason: "not 5 PM Eastern" });

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Service role not configured." }, { status: 503 });
  }

  const date = easternToday();
  const [recaps, recipients, mgmt] = await Promise.all([
    computeFacilityRecaps(admin),
    facilityRecipients(admin),
    managementEmails(admin), // management is BCC'd on every facility recap
  ]);

  let sent = 0;
  const skipped: string[] = [];
  for (const r of recaps) {
    const to = recipients.get(r.facilityId);
    if (!to || to.length === 0) {
      skipped.push(r.name);
      continue;
    }
    try {
      await sendResend(to, `${r.name} — Weekly Recap (${date})`, renderFacilityRecap(r, date), mgmt);
      sent++;
    } catch {
      skipped.push(r.name);
    }
  }
  return NextResponse.json({ ok: true, sent, skipped, managementCopied: mgmt.length });
}
