import { randomUUID } from "crypto";

// Create a Square "Quick Pay" payment link for an EXACT amount, so the invoice
// email can show a "Pay $X" button pre-filled with that month's fee. Returns
// the URL, or null when Square isn't configured or the call fails (the caller
// then falls back to the facility's static Square link).
//
// Requires env vars (set on the server):
//   SQUARE_ACCESS_TOKEN  — from Square Developer dashboard
//   SQUARE_LOCATION_ID   — the location to attribute payments to
//   SQUARE_ENV           — "sandbox" for testing, anything else = production
export async function createSquarePaymentLink(opts: {
  amount: number; // dollars
  name: string;
}): Promise<{ url: string | null; error: string | null }> {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!token) return { url: null, error: "SQUARE_ACCESS_TOKEN not set on the server" };
  if (!locationId) return { url: null, error: "SQUARE_LOCATION_ID not set on the server" };

  const cents = Math.round(opts.amount * 100);
  if (!Number.isFinite(cents) || cents <= 0)
    return { url: null, error: "amount must be greater than 0" };

  const base =
    process.env.SQUARE_ENV === "sandbox"
      ? "https://connect.squareupsandbox.com"
      : "https://connect.squareup.com";

  try {
    const res = await fetch(`${base}/v2/online-checkout/payment-links`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": "2024-08-21",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idempotency_key: randomUUID(),
        quick_pay: {
          name: opts.name.slice(0, 255),
          price_money: { amount: cents, currency: "USD" },
          location_id: locationId,
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Surface Square's own error so misconfig (wrong token/location, sandbox
      // vs production, amount limit) is diagnosable instead of a silent null.
      const detail =
        data?.errors?.[0]?.detail ||
        data?.errors?.[0]?.code ||
        `Square returned HTTP ${res.status}`;
      console.error("Square payment link failed:", res.status, JSON.stringify(data?.errors ?? data));
      return { url: null, error: String(detail) };
    }
    const url = data?.payment_link?.url;
    return typeof url === "string"
      ? { url, error: null }
      : { url: null, error: "Square response had no payment link URL" };
  } catch (e) {
    return { url: null, error: e instanceof Error ? e.message : "Square request failed" };
  }
}
