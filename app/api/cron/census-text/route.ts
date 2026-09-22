import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { easternToday, easternHour } from "@/lib/report/eodSummary";
import { logCronRun, alreadySentToday } from "@/lib/report/cronLog";
import { computeFacilityRecaps } from "@/lib/report/facilityRecap";
import { censusSmsBody } from "@/lib/report/censusText";
import { sendSms, parseNumbers } from "@/lib/sms";
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
      !isDemoFacility(f.name) &&
      !isDemoFacility(f.short_name) &&
      !isExcludedFacility(f.name) &&
      !isExcludedFacility(f.short_name)
  );

  // Management numbers get EVERY facility's census text (like an email BCC).
  const { data: mgmt } = await admin.from("profiles").select("sms_phone").eq("role", "management");
  const mgmtNumbers = Array.from(
    new Set(((mgmt as { sms_phone: string | null }[]) ?? []).flatMap((m) => parseNumbers(m.sms_phone)))
  );
  const anyFacilityNumber = facilities.some((f) => parseNumbers(f.sms_phone).length > 0);

  if (!anyFacilityNumber && mgmtNumbers.length === 0)
    return NextResponse.json({ ok: true, sent: 0, reason: "no SMS numbers set" });

  const recaps = await computeFacilityRecaps(admin, {
    facilityIds: facilities.map((f) => f.id),
  }).catch(() => []);
  const recapById = new Map(recaps.map((r) => [r.facilityId, r]));

  let sent = 0;
  const skipped: string[] = [];
  for (const f of facilities) {
    const label = f.short_name || f.name;
    const recap = recapById.get(f.id);
    const body = recap ? censusSmsBody(recap) : "";
    if (!body) continue; // no census this week
    const recipients = Array.from(new Set([...parseNumbers(f.sms_phone), ...mgmtNumbers]));
    if (recipients.length === 0) continue;
    for (const to of recipients) {
      const res = await sendSms(to, body);
      if (res.ok) sent++;
      else skipped.push(`${label}→${to} (${res.error})`);
    }
  }

  await logCronRun(admin, "census-text", `SENT ${date} — texted ${sent}, skipped ${skipped.length}`);
  return NextResponse.json({ ok: true, sent, skipped });
}
