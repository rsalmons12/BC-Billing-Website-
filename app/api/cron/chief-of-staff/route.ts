import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { managementEmails, sendResend, easternToday, easternHour } from "@/lib/report/eodSummary";
import { computeChiefBrief, renderChiefBrief } from "@/lib/report/chiefOfStaff";

// Runs on a schedule (see vercel.json) — ~7 AM Eastern — and emails the
// Chief-of-Staff morning brief (aging AR priorities, open auth issues, census
// misses across every facility) to whoever is marked "management".
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fires at 11:00 AND 12:00 UTC; only the one at 7 AM Eastern actually sends,
  // so it stays at 7 AM ET through daylight-saving changes. ?force=1 bypasses.
  const url = new URL(request.url);
  if (easternHour() !== 7 && url.searchParams.get("force") !== "1")
    return NextResponse.json({ ok: true, sent: false, reason: "not 7 AM Eastern" });

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Service role not configured." }, { status: 503 });
  }

  const to = await managementEmails(admin);
  if (to.length === 0)
    return NextResponse.json({ ok: false, reason: "no management emails on file" });

  const date = easternToday();
  const brief = await computeChiefBrief(admin);
  try {
    await sendResend(to, `Chief of Staff — Morning Brief (${date})`, renderChiefBrief(brief, date));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "send failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, sent: true, recipients: to.length, facilities: brief.facilities.length });
}
