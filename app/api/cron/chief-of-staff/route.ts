import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { managementEmails, sendResend, easternToday, easternHour } from "@/lib/report/eodSummary";
import { computeChiefBrief, renderChiefBrief } from "@/lib/report/chiefOfStaff";
import { logCronRun } from "@/lib/report/cronLog";

// Runs on a schedule (see vercel.json) — ~7 AM Eastern — and emails the
// Chief-of-Staff morning brief (aging AR priorities, open auth issues, census
// misses across every facility) to whoever is marked "management".
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  // Create the admin client first so we can heartbeat-log EVERY invocation —
  // including a rejected one — into cron_log. That's how we tell "Vercel never
  // called the job" apart from "it called but was blocked".
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Service role not configured." }, { status: 503 });
  }

  const url = new URL(request.url);
  const h = easternHour();
  const secret = process.env.CRON_SECRET;
  const authOk = !secret || request.headers.get("authorization") === `Bearer ${secret}`;
  await logCronRun(admin, "chief-of-staff", `invoked (ET hour ${h}, auth ${authOk ? "ok" : "FAIL"})`);
  if (!authOk) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Single daily cron at 11:00 UTC (see vercel.json). We accept any invocation
  // in the MORNING Eastern window (6–10 AM) rather than one exact hour, so the
  // one guaranteed daily run always sends — 7 AM ET in summer (EDT), 6 AM in
  // winter (EST) — and small cron delays don't skip the day. ?force=1 bypasses.
  if (!(h >= 6 && h <= 10) && url.searchParams.get("force") !== "1") {
    await logCronRun(admin, "chief-of-staff", `skipped: outside morning window (ET hour ${h})`);
    return NextResponse.json({ ok: true, sent: false, reason: `outside morning window (ET hour ${h})` });
  }

  const to = await managementEmails(admin);
  if (to.length === 0) {
    await logCronRun(admin, "chief-of-staff", "skipped: no management emails on file");
    return NextResponse.json({ ok: false, reason: "no management emails on file" });
  }

  const date = easternToday();
  let brief;
  try {
    brief = await computeChiefBrief(admin);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "brief compute failed";
    await logCronRun(admin, "chief-of-staff", `error building brief: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  try {
    await sendResend(to, `Chief of Staff — Morning Brief (${date})`, renderChiefBrief(brief, date));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "send failed";
    await logCronRun(admin, "chief-of-staff", `error sending: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
  await logCronRun(admin, "chief-of-staff", `sent to ${to.length} recipient(s)`);
  return NextResponse.json({ ok: true, sent: true, recipients: to.length, facilities: brief.facilities.length });
}
