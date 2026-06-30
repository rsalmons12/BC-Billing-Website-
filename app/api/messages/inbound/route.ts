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

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>(?=)/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Keep just the new reply text, dropping the quoted original + signature.
function extractReply(text: string): string {
  const lines = text.split(/\r?\n/);
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*>/.test(l)) { cut = i; break; }
    if (/^-{3,}\s*Original Message/i.test(l)) { cut = i; break; }
    if (/^On\b.*\bwrote:/.test(l)) { cut = i; break; }
    if (/^On\b/.test(l) && i + 1 < lines.length && /\bwrote:/.test(lines[i + 1])) {
      cut = i;
      break;
    }
    if (/^--\s*$/.test(l)) { cut = i; break; } // signature delimiter
    if (/^_{5,}$/.test(l)) { cut = i; break; } // Outlook divider
  }
  const trimmed = lines.slice(0, cut).join("\n").trim();
  return trimmed || text.trim();
}

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

  // The webhook is metadata-only — the body must be fetched separately by
  // email_id via the Resend API.
  let body = String(
    (data.text as string) ?? (data.html as string) ?? (data.body as string) ?? ""
  );
  const emailId = String(data.email_id ?? data.id ?? "");
  // Try the known retrieve endpoints (Resend's inbound path has shifted); the
  // first that returns text/html wins. `diag` is surfaced in the response so we
  // can see which endpoint works without server logs.
  const diag: Record<string, unknown> = { emailId };
  if (!body && emailId && process.env.RESEND_API_KEY) {
    const candidates = [
      `https://api.resend.com/inbound/${emailId}`,
      `https://api.resend.com/received/${emailId}`,
      `https://api.resend.com/received-emails/${emailId}`,
      `https://api.resend.com/inbound-emails/${emailId}`,
      `https://api.resend.com/emails/inbound/${emailId}`,
      `https://api.resend.com/emails/${emailId}/content`,
      `https://api.resend.com/emails/${emailId}/raw`,
      `https://api.resend.com/emails/${emailId}/received`,
    ];
    for (const url of candidates) {
      try {
        const r = await fetch(url, {
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        });
        diag[url] = r.status;
        if (r.ok) {
          const full = (await r.json()) as { text?: string; html?: string };
          const t = full.text || stripHtml(full.html || "");
          diag[`${url}#keys`] = Object.keys(full).join(",");
          if (t) {
            body = t;
            break;
          }
        }
      } catch (e) {
        diag[url] = e instanceof Error ? e.message : "err";
      }
    }
  }
  body = extractReply(body) || "(no text)";

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

  // Always 200 so the provider doesn't retry endlessly. `diag` shows which
  // retrieve endpoint (if any) returned the body — temporary, for debugging.
  return NextResponse.json({ ok: true, bodyChars: body.length, diag });
}
