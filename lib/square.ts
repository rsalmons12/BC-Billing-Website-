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
}): Promise<string | null> {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!token || !locationId) return null;

  const cents = Math.round(opts.amount * 100);
  if (!Number.isFinite(cents) || cents <= 0) return null;

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
    if (!res.ok) return null;
    const data = await res.json();
    const url = data?.payment_link?.url;
    return typeof url === "string" ? url : null;
  } catch {
    return null;
  }
}
