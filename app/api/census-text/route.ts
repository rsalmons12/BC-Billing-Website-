import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeFacilityRecaps } from "@/lib/report/facilityRecap";
import { censusSmsBody } from "@/lib/report/censusText";
import { sendSms } from "@/lib/sms";
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

  let body: { to?: string; all?: boolean } = {};
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
    for (const f of visible) {
      const recap = recapById.get(f.id);
      const text = recap ? censusSmsBody(recap) : "";
      if (text) {
        const res = await sendSms(requested, text);
        return res.ok
          ? NextResponse.json({ ok: true, preview: true, sentTo: requested })
          : NextResponse.json({ error: res.error }, { status: 502 });
      }
    }
    return NextResponse.json({ error: "No facility has census data to preview yet." }, { status: 400 });
  }

  // SEND NOW to every facility with an SMS number.
  const targets = visible.filter((f) => f.sms_phone && String(f.sms_phone).trim());
  if (targets.length === 0)
    return NextResponse.json({ error: "No facilities have an SMS number set (Admin → Facilities)." }, { status: 400 });

  let sent = 0;
  const skipped: string[] = [];
  for (const f of targets) {
    const label = f.short_name || f.name;
    const recap = recapById.get(f.id);
    const text = recap ? censusSmsBody(recap) : "";
    if (!text) {
      skipped.push(`${label} (no census)`);
      continue;
    }
    const res = await sendSms(f.sms_phone!, text);
    if (res.ok) sent++;
    else skipped.push(`${label} (${res.error})`);
  }
  return NextResponse.json({ ok: true, sent, skipped });
}
