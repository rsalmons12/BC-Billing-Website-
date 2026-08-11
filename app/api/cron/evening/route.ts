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
import {
  computeFacilityRecaps,
  facilityRecipients,
  recapBccByFacility,
  renderFacilityRecap,
} from "@/lib/report/facilityRecap";

// One evening job (~5 PM ET) that does BOTH the end-of-day production summary
// and the per-facility daily recaps. Combined into a single cron so the app
// uses only 2 scheduled jobs total (morning brief + this) — within Vercel's
// Hobby-plan limit, so all sends fire on any plan.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Single daily cron at 21:00 UTC (see vercel.json). Accept any invocation in
  // the late-afternoon Eastern window (4–8 PM) so the one guaranteed daily run
  // always sends — 5 PM ET in summer (EDT), 4 PM in winter (EST) — and small
  // cron delays don't skip the day. ?force=1 bypasses.
  const url = new URL(request.url);
  const h = easternHour();
  if (!(h >= 16 && h <= 20) && url.searchParams.get("force") !== "1")
    return NextResponse.json({ ok: true, sent: false, reason: `outside evening window (ET hour ${h})` });

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Service role not configured." }, { status: 503 });
  }

  const date = easternToday();
  const result: { eod?: unknown; recaps?: unknown } = {};

  // 1) End-of-day production summary → management.
  try {
    const to = await managementEmails(admin);
    const summaries = await buildTeamDigest(admin, date);
    if (to.length && summaries.length) {
      const totWorked = summaries.reduce((s, c) => s + c.worked, 0);
      await sendResend(
        to,
        `End-of-Day Production — ${totWorked} claims worked across ${summaries.length} collector${
          summaries.length === 1 ? "" : "s"
        }`,
        renderDigest(summaries, date)
      );
      result.eod = { sent: true, collectors: summaries.length };
    } else {
      result.eod = { sent: false, reason: to.length ? "no production today" : "no management emails" };
    }
  } catch (e) {
    result.eod = { error: e instanceof Error ? e.message : "eod send failed" };
  }

  // 2) Per-facility daily recaps → each facility's own login, management BCC'd.
  try {
    const [recaps, recipients, mgmt, extraBcc] = await Promise.all([
      computeFacilityRecaps(admin),
      facilityRecipients(admin),
      managementEmails(admin),
      recapBccByFacility(admin),
    ]);
    let sent = 0;
    const skipped: string[] = [];
    for (const r of recaps) {
      const to = recipients.get(r.facilityId);
      if (!to || to.length === 0) {
        skipped.push(r.name);
        continue;
      }
      // Management BCC + this facility's own extra BCC(s), if any.
      const bcc = Array.from(new Set([...mgmt, ...(extraBcc.get(r.facilityId) ?? [])]));
      try {
        await sendResend(to, `${r.name} — Daily Recap (${date})`, renderFacilityRecap(r, date), bcc);
        sent++;
      } catch {
        skipped.push(r.name);
      }
    }
    result.recaps = { sent, skipped, managementCopied: mgmt.length };
  } catch (e) {
    result.recaps = { error: e instanceof Error ? e.message : "recap send failed" };
  }

  return NextResponse.json({ ok: true, ...result });
}
