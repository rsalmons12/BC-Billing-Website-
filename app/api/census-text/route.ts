import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeFacilityRecaps, type FacilityRecap } from "@/lib/report/facilityRecap";
import { censusSmsBody } from "@/lib/report/censusText";
import { renderCensusPng } from "@/lib/report/censusImage";
import { sendSms, parseNumbers, fetchSmsStatus } from "@/lib/sms";

const caption = (label: string) => `${label}: weekly census update. Full recap in the app.`;

// Plain text is the reliable default. The branded MMS image is opt-in via
// CENSUS_MMS=1; if the image can't be built/hosted it falls back to text so a
// message always arrives.
const MMS_ENABLED = process.env.CENSUS_MMS === "1";

// Pre-render the census image and host it as a static file so Twilio fetches a
// ready-made PNG (fast) instead of triggering the heavy recap computation on
// demand — which timed out (MMS error 11200). Returns a short-lived signed URL.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function hostCensusImage(admin: any, facilityId: string, recap: FacilityRecap): Promise<string | null> {
  try {
    const png = await renderCensusPng(recap);
    const objectPath = `census-mms/${facilityId}-${Date.now()}.png`;
    const up = await admin.storage
      .from("attachments")
      .upload(objectPath, png, { contentType: "image/png", upsert: true });
    if (up.error) return null;
    const signed = await admin.storage.from("attachments").createSignedUrl(objectPath, 900);
    return signed.data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sendCensus(admin: any, to: string, label: string, facilityId: string, recap: FacilityRecap) {
  if (MMS_ENABLED) {
    const media = await hostCensusImage(admin, facilityId, recap);
    if (media) {
      const mms = await sendSms(to, caption(label), media);
      if (mms.ok) return { ok: true, error: null, via: "mms" as const, sid: mms.sid, media };
    }
  }
  const sms = await sendSms(to, censusSmsBody(recap));
  return { ok: sms.ok, error: sms.error, via: "sms" as const, sid: sms.sid, media: undefined as string | undefined };
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
        const res = await sendCensus(admin, requested, label, f.id, recap);
        if (!res.ok) return NextResponse.json({ error: res.error }, { status: 502 });
        // Give Twilio a moment, then report the real delivery status + error code
        // so a "sent but not received" is diagnosable right in the UI.
        let diag: { status?: string; errorCode?: number | null; errorMessage?: string | null } = {};
        if (res.sid) {
          await new Promise((r) => setTimeout(r, 5000));
          diag = await fetchSmsStatus(res.sid);
        }
        return NextResponse.json({
          ok: true,
          preview: true,
          sentTo: requested,
          via: res.via,
          media: res.media ?? null,
          ...diag,
        });
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
      const res = await sendCensus(admin, to, p.facility, p.facilityId, p.recap);
      if (res.ok) sent++;
      else skipped.push(`${p.facility}→${mask(to)} (${res.error})`);
    }
  }
  return NextResponse.json({ ok: true, sent, skipped });
}
