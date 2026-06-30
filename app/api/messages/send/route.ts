import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Sends an email to a facility via Resend and logs it to facility_messages.
// The Resend key lives only in the server env (RESEND_API_KEY).
const FROM = process.env.MESSAGES_FROM_EMAIL || "BC Billing <collections@bcbilling.cloud>";

const HIPAA_FOOTER = `
<hr style="margin-top:24px;border:none;border-top:1px solid #ddd" />
<p style="font-size:11px;color:#888;line-height:1.5;margin-top:8px">
CONFIDENTIALITY NOTICE: This email and any attachments are intended only for the
named recipient and may contain Protected Health Information (PHI) that is
privileged and confidential under HIPAA and other law. If you are not the
intended recipient, any review, use, disclosure, or distribution is prohibited.
If you received this in error, please notify the sender and delete all copies.
</p>`;

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json(
      { error: "Email is not configured yet (RESEND_API_KEY missing)." },
      { status: 503 }
    );
  }

  let body: {
    facility_id?: string;
    claim_id?: string | null;
    patient_name?: string | null;
    subject?: string;
    message?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { facility_id, claim_id, patient_name } = body;
  const subject = (body.subject ?? "").trim() || "Message from BC Billing";
  const message = (body.message ?? "").trim();
  if (!facility_id || !message) {
    return NextResponse.json(
      { error: "Pick a facility and write a message." },
      { status: 400 }
    );
  }

  // Facility email + name (RLS ensures the caller may access this facility).
  const { data: fac } = await supabase
    .from("facilities")
    .select("name, short_name, email")
    .eq("id", facility_id)
    .maybeSingle();
  if (!fac?.email) {
    return NextResponse.json(
      { error: "That facility has no email on file. Add one in Admin → Facilities." },
      { status: 400 }
    );
  }

  const replyTo = user.email ?? undefined;
  const safeBody = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6">
    <p style="white-space:pre-wrap">${safeBody}</p>
    ${HIPAA_FOOTER}
  </div>`;

  // Send via Resend.
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [fac.email],
      reply_to: replyTo,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    return NextResponse.json(
      { error: `Email failed: ${detail.slice(0, 300)}` },
      { status: 502 }
    );
  }

  // Log the outbound message to the thread.
  await supabase.from("facility_messages").insert({
    facility_id,
    claim_id: claim_id ?? null,
    patient_name: patient_name ?? null,
    subject,
    body: message,
    direction: "outbound",
    from_email: FROM,
    to_email: fac.email,
    sender_id: user.id,
  });

  return NextResponse.json({ ok: true });
}
