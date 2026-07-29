import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  managementEmails,
  usersEmailMap,
  facilityNamer,
  collectorSummary,
  renderDigest,
  sendResend,
  easternToday,
  type CollectorSummary,
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

  // Everyone who worked today — from the Queue production log AND from claims
  // marked worked in Collections (claim_work.updated_by).
  const [{ data: prod }, { data: cw }] = await Promise.all([
    admin.from("production_log").select("collector_id").eq("worked_on", date),
    admin.from("claim_work").select("updated_by").eq("date_worked", date),
  ]);
  const collectorIds = Array.from(
    new Set(
      [
        ...(prod ?? []).map((p: { collector_id: string }) => p.collector_id),
        ...(cw ?? []).map((c: { updated_by: string | null }) => c.updated_by),
      ].filter(Boolean) as string[]
    )
  );
  if (collectorIds.length === 0)
    return NextResponse.json({ ok: true, sent: false, reason: "no production today" });

  const facName = await facilityNamer(admin);
  const emailOf = await usersEmailMap(admin);
  const summaries: CollectorSummary[] = [];
  for (const id of collectorIds)
    summaries.push(await collectorSummary(admin, id, date, facName, emailOf));
  summaries.sort((a, b) => b.worked - a.worked);

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
