import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  managementEmails,
  buildTeamDigest,
  renderDigest,
  sendResend,
  easternToday,
  easternHour,
} from "@/lib/report/eodSummary";

// Runs on a schedule (see vercel.json) — around 5 PM Eastern — and emails a
// digest of every collector's day to whoever is marked "management".
// No preset recipients: they come from the management accounts themselves.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  // Vercel Cron sends this header when CRON_SECRET is set; reject anything else.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Fires at 21:00 AND 22:00 UTC; only the one at 5 PM Eastern actually sends,
  // so it stays at 5 PM ET through daylight-saving changes. ?force=1 bypasses
  // (for a manual cron test).
  const url = new URL(request.url);
  if (easternHour() !== 17 && url.searchParams.get("force") !== "1")
    return NextResponse.json({ ok: true, sent: false, reason: "not 5 PM Eastern" });

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
  const summaries = await buildTeamDigest(admin, date);
  if (summaries.length === 0)
    return NextResponse.json({ ok: true, sent: false, reason: "no production today" });

  const totWorked = summaries.reduce((s, c) => s + c.worked, 0);
  try {
    await sendResend(
      to,
      `End-of-Day Production — ${totWorked} claims worked across ${summaries.length} collector${
        summaries.length === 1 ? "" : "s"
      }`,
      renderDigest(summaries, date)
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "send failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, sent: true, collectors: summaries.length, recipients: to.length });
}
