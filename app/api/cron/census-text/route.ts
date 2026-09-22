import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/supabase/page";
import { easternToday, easternHour } from "@/lib/report/eodSummary";
import { logCronRun, alreadySentToday } from "@/lib/report/cronLog";
import { facilityCensusCompare } from "@/lib/report/census";
import { censusSmsBody } from "@/lib/report/censusText";
import { sendSms } from "@/lib/sms";
import { isDemoFacility, isExcludedFacility } from "@/lib/claims";

// Weekly: text each facility (that has an SMS number on file) a short summary of
// its current census week. Fired by GitHub Actions on a weekly schedule; the
// daily-key cron_log guard makes the several morning attempts idempotent.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fac = { id: string; name: string; short_name: string | null; sms_phone: string | null };

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Service role not configured." }, { status: 503 });
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  await logCronRun(admin, "census-text", `invoked (force ${force})`);

  // Send ~9 AM Eastern; fires at 13:00 & 14:00 UTC and only the 9 AM ET one runs.
  if (!force && easternHour() !== 9)
    return NextResponse.json({ ok: true, sent: false, reason: "not 9 AM Eastern" });

  const date = easternToday();
  if (!force && (await alreadySentToday(admin, "census-text", date)))
    return NextResponse.json({ ok: true, sent: false, reason: "already sent today" });

  if (!process.env.TWILIO_ACCOUNT_SID)
    return NextResponse.json({ error: "Twilio not configured." }, { status: 503 });

  const { data: facData } = await admin
    .from("facilities")
    .select("id, name, short_name, sms_phone");
  const facilities = ((facData as Fac[]) ?? []).filter(
    (f) =>
      f.sms_phone &&
      String(f.sms_phone).trim() &&
      !isDemoFacility(f.name) &&
      !isDemoFacility(f.short_name) &&
      !isExcludedFacility(f.name) &&
      !isExcludedFacility(f.short_name)
  );

  if (facilities.length === 0)
    return NextResponse.json({ ok: true, sent: 0, reason: "no facilities have an SMS number" });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await selectAll<any>((f, t) =>
    admin.from("census").select("*").range(f, t)
  ).catch(() => []);

  let sent = 0;
  const skipped: string[] = [];
  for (const f of facilities) {
    const { current } = facilityCensusCompare(f.id, rows);
    const label = f.short_name || f.name;
    if (!current) {
      skipped.push(`${label} (no census)`);
      continue;
    }
    const curRows = rows.filter(
      (r) => r.facility_id === f.id && r.week_start === current.week
    );
    const body = censusSmsBody(label, current, curRows);
    const res = await sendSms(f.sms_phone!, body);
    if (res.ok) sent++;
    else skipped.push(`${label} (${res.error})`);
  }

  await logCronRun(admin, "census-text", `SENT ${date} — texted ${sent}, skipped ${skipped.length}`);
  return NextResponse.json({ ok: true, sent, skipped });
}
