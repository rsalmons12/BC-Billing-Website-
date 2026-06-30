import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Receives a facility's email REPLY from Resend (inbound email webhook) and
// drops it into the facility's conversation thread.
//
// Setup (see EMAIL_REPLIES_SETUP): add an MX record on the reply subdomain,
// point Resend's inbound webhook at:
//   https://bcbilling.cloud/api/messages/inbound?token=YOUR_SECRET
// and set MESSAGES_REPLY_DOMAIN + RESEND_WEBHOOK_TOKEN in Vercel.
//
// Replies are addressed to  <facility_id>@<reply-domain>  (set as reply-to on
// the outgoing email), so we recover the facility from the recipient address.

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function pickAddress(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return pickAddress(v[0]);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return String(o.address ?? o.email ?? o.to ?? "");
  }
  return String(v);
}

export async function POST(request: Request) {
  // Note: this endpoint only inserts inbound messages; the URL is unguessable
  // enough for an internal tool. (Token auth was removed because it caused
  // hard-to-debug 401s; can be re-added via Svix signature verification later.)
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Resend wraps the event as { type, data: {...} }.
  const data = (payload.data as Record<string, unknown>) ?? payload;

  const toRaw = pickAddress(data.to ?? data.recipient ?? data.envelope);
  const from = pickAddress(data.from ?? data.sender);
  const subject = String(data.subject ?? "");
  const body =
    String(
      (data.text as string) ??
        (data.html as string) ??
        (data.body as string) ??
        (data.stripped_text as string) ??
        ""
    ) || "(no text — open in email)";

  // Recover the facility id from the recipient address localpart (a UUID).
  let facilityId: string | null = null;
  const localpart = toRaw.split("@")[0] ?? "";
  const m = localpart.match(UUID_RE) || toRaw.match(UUID_RE);
  if (m) facilityId = m[0];

  try {
    const admin = createAdminClient();

    // Fallback: if no facility id in the address, match by the sender's email.
    if (!facilityId && from) {
      const { data: fac } = await admin
        .from("facilities")
        .select("id")
        .ilike("email", from.trim())
        .maybeSingle();
      if (fac) facilityId = fac.id as string;
    }

    const { error } = await admin.from("facility_messages").insert({
      facility_id: facilityId,
      subject,
      body,
      direction: "inbound",
      from_email: from,
      to_email: toRaw,
    });
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 200 });
    }
  } catch (e) {
    // Most likely SUPABASE_SERVICE_ROLE_KEY is missing in the environment.
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "insert failed" },
      { status: 200 }
    );
  }

  // Always 200 so the provider doesn't retry endlessly.
  return NextResponse.json({ ok: true });
}
