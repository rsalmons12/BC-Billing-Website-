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

  // Single daily cron at 11:00 UTC (see vercel.json). We accept any invocation
  // in the MORNING Eastern window (6–10 AM) rather than one exact hour, so the
  // one guaranteed daily run always sends — 7 AM ET in summer (EDT), 6 AM in
  // winter (EST) — and small cron delays don't skip the day. ?force=1 bypasses.
  const url = new URL(request.url);
  const h = easternHour();
  if (!(h >= 6 && h <= 10) && url.searchParams.get("force") !== "1")
    return NextResponse.json({ ok: true, sent: false, reason: `outside morning window (ET hour ${h})` });

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
  let brief;
  try {
    brief = await computeChiefBrief(admin);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "brief compute failed" }, { status: 500 });
  }
  try {
    await sendResend(to, `Chief of Staff — Morning Brief (${date})`, renderChiefBrief(brief, date));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "send failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, sent: true, recipients: to.length, facilities: brief.facilities.length });
}
