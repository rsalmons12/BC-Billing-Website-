// Send an SMS via Twilio's REST API. Returns { ok, error }. Configured with
// three server env vars:
//   TWILIO_ACCOUNT_SID  — starts with "AC…"
//   TWILIO_AUTH_TOKEN   — the account's auth token
//   TWILIO_FROM         — a Twilio phone number in E.164 (e.g. +15551234567)
// Kept dependency-free (plain fetch) so it works the same on Render.

// Normalize a US phone to E.164 (+1XXXXXXXXXX). Returns "" if it can't.
export function toE164(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (s.startsWith("+")) {
    const digits = s.slice(1).replace(/\D/g, "");
    return digits.length >= 8 ? `+${digits}` : "";
  }
  const d = s.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return "";
}

export async function sendSms(
  to: string,
  body: string
): Promise<{ ok: boolean; error: string | null }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token) return { ok: false, error: "Twilio not configured (SID/token missing)." };
  if (!from) return { ok: false, error: "TWILIO_FROM not set on the server." };

  const dest = toE164(to);
  if (!dest) return { ok: false, error: `Invalid phone number: ${to}` };

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: dest, From: from, Body: body.slice(0, 1500) }).toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data?.message || `Twilio returned HTTP ${res.status}`;
      return { ok: false, error: String(detail) };
    }
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Twilio request failed" };
  }
}
