import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeFacilityRecaps, type FacilityRecap } from "@/lib/report/facilityRecap";
import { censusSmsBody } from "@/lib/report/censusText";
import { censusImageToken } from "@/lib/report/censusImageToken";
import { sendSms, parseNumbers } from "@/lib/sms";

const BASE_URL = process.env.PUBLIC_BASE_URL || "https://bcbilling.cloud";
const imageUrl = (facilityId: string) =>
  `${BASE_URL}/api/census-image?f=${encodeURIComponent(facilityId)}&t=${censusImageToken(facilityId)}`;
const caption = (label: string) => `${label}: weekly census update. Full recap in the app.`;

// Plain text is the reliable default. The branded MMS image is opt-in via
// CENSUS_MMS=1 (enable only after MMS is verified on the number/campaign); if
// the image fails it still falls back to text so a message always arrives.
const MMS_ENABLED = process.env.CENSUS_MMS === "1";
async function sendCensus(to: string, label: string, facilityId: string, recap: FacilityRecap) {
  if (MMS_ENABLED) {
    const mms = await sendSms(to, caption(label), imageUrl(facilityId));
    if (mms.ok) return { ok: true, error: null, via: "mms" as const };
  }
  const sms = await sendSms(to, censusSmsBody(recap));
  return { ok: sms.ok, error: sms.error, via: "sms" as const };
}
import { isDemoFacility, isExcludedFacility } from "@/lib/claims";

// Management-only manual trigger for the weekly census text, so it can be tested
// without waiting for the Monday cron.
//   { to: "5551234567" }  -> texts a PREVIEW (a real facility's current census
//                            summary) to that number only.
//   { all: true }         -> texts every facility that has an SMS number on file
//                            its own census summary, right now.
export const dynamic = "force-dynamic";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fac = { id: string; name: string; short_name: string | null; sms_phone: string | null };

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "management")
    return NextResponse.json({ error: "Management only." }, { status: 403 });

  if (!process.env.TWILIO_ACCOUNT_SID)
    return NextResponse.json(
      { error: "Texting isn't configured yet — set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM on the server." },
      { status: 503 }
    );

  let body: { to?: string; all?: boolean; dryRun?: boolean; facilityId?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* no body is fine */
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Notifications need SUPABASE_SERVICE_ROLE_KEY set on the server." },
      { status: 503 }
    );
  }

  const { data: facData } = await admin.from("facilities").select("id, name, short_name, sms_phone");
  const visible = ((facData as Fac[]) ?? []).filter(
    (f) =>
      !isDemoFacility(f.name) &&
      !isDemoFacility(f.short_name) &&
      !isExcludedFacility(f.name) &&
      !isExcludedFacility(f.short_name)
  );

  // Build recaps once so every text matches the Census page exactly (levels of
  // care, reimbursement mix, expected revenue on outstanding claims).
  const recaps = await computeFacilityRecaps(admin, {
    facilityIds: visible.map((f) => f.id),
  }).catch(() => []);
  const recapById = new Map(recaps.map((r) => [r.facilityId, r]));

  // PREVIEW to one number: use the first facility that has a current census week.
  const requested = String(body.to ?? "").trim();
  if (requested) {
    // Preview the chosen facility if given, otherwise the first with census.
    const chosen = body.facilityId ? visible.find((f) => f.id === body.facilityId) : null;
    const candidates = chosen ? [chosen] : visible;
    for (const f of candidates) {
      const recap = recapById.get(f.id);
      if (recap && recap.census?.current) {
        const label = f.short_name || f.name;
        const res = await sendCensus(requested, label, f.id, recap);
        return res.ok
          ? NextResponse.json({ ok: true, preview: true, sentTo: requested, via: res.via })
          : NextResponse.json({ error: res.error }, { status: 502 });
      }
    }
    return NextResponse.json({ error: "No facility has census data to preview yet." }, { status: 400 });
  }

  // Management numbers get EVERY facility's census text (like an email BCC).
  const { data: mgmt } = await admin.from("profiles").select("sms_phone").eq("role", "management");
  const mgmtNumbers = Array.from(
    new Set(((mgmt as { sms_phone: string | null }[]) ?? []).flatMap((m) => parseNumbers(m.sms_phone)))
  );
  const anyFacilityNumber = visible.some((f) => parseNumbers(f.sms_phone).length > 0);
  if (!anyFacilityNumber && mgmtNumbers.length === 0)
    return NextResponse.json(
      { error: "No SMS numbers set — add facility numbers (Admin → Facilities) or a management number (Admin → users)." },
      { status: 400 }
    );

  // Build the send plan: each facility gets ONLY its own census text, to its own
  // number(s) plus the management numbers. A facility number therefore only ever
  // appears under its own facility.
  const mask = (n: string) => `…${n.slice(-4)}`;
  const plan: { facility: string; facilityId: string; recap: FacilityRecap; recipients: string[] }[] = [];
  for (const f of visible) {
    const label = f.short_name || f.name;
    const recap = recapById.get(f.id);
    if (!recap || !recap.census?.current) continue; // no census this week — skip
    const recipients = Array.from(new Set([...parseNumbers(f.sms_phone), ...mgmtNumbers]));
    if (recipients.length === 0) continue;
    plan.push({ facility: label, facilityId: f.id, recap, recipients });
  }

  // Dry run: show who would get what, without sending.
  if (body.dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      managementNumbers: mgmtNumbers.map(mask),
      plan: plan.map((p) => ({
        facility: p.facility,
        recipients: p.recipients.map(mask),
        recipientCount: p.recipients.length,
      })),
    });
  }

  // SEND NOW — each facility's branded census image (MMS), falling back to the
  // plain-text summary if MMS fails.
  let sent = 0;
  const skipped: string[] = [];
  for (const p of plan) {
    for (const to of p.recipients) {
      const res = await sendCensus(to, p.facility, p.facilityId, p.recap);
      if (res.ok) sent++;
      else skipped.push(`${p.facility}→${mask(to)} (${res.error})`);
    }
  }
  return NextResponse.json({ ok: true, sent, skipped });
}
