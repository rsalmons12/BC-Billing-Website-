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

export type SquarePayment = {
  id: string;
  createdAt: string;
  amount: number; // dollars
  status: string; // COMPLETED / APPROVED / PENDING / FAILED / CANCELED
  note: string | null;
  receiptUrl: string | null;
};

// List recent Square payments (money actually received), newest first, for the
// configured location. Used by the Square Payments panel so the owner can SEE
// what facilities have paid — the app has no webhook, so nothing else records
// an incoming Square payment. Returns the payments, or an error string.
export async function listSquarePayments(opts?: {
  days?: number;
  limit?: number;
}): Promise<{ payments: SquarePayment[]; error: string | null }> {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!token) return { payments: [], error: "SQUARE_ACCESS_TOKEN not set on the server" };
  if (!locationId) return { payments: [], error: "SQUARE_LOCATION_ID not set on the server" };

  const base =
    process.env.SQUARE_ENV === "sandbox"
      ? "https://connect.squareupsandbox.com"
      : "https://connect.squareup.com";

  const days = Math.max(1, Math.min(opts?.days ?? 60, 365));
  const beginTime = new Date(Date.now() - days * 86400000).toISOString();
  const limit = Math.max(1, Math.min(opts?.limit ?? 100, 100));

  try {
    const out: SquarePayment[] = [];
    let cursor: string | undefined;
    // Page through results (Square caps a page; a busy account may need a few).
    for (let page = 0; page < 5; page++) {
      const params = new URLSearchParams({
        location_id: locationId,
        begin_time: beginTime,
        sort_order: "DESC",
        limit: String(limit),
      });
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`${base}/v2/payments?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Square-Version": "2024-08-21",
          "Content-Type": "application/json",
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail =
          data?.errors?.[0]?.detail ||
          data?.errors?.[0]?.code ||
          `Square returned HTTP ${res.status}`;
        return { payments: out, error: String(detail) };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const p of (data?.payments ?? []) as any[]) {
        out.push({
          id: String(p.id ?? ""),
          createdAt: String(p.created_at ?? ""),
          amount: (Number(p.amount_money?.amount) || 0) / 100,
          status: String(p.status ?? ""),
          note: p.note ?? null,
          receiptUrl: p.receipt_url ?? null,
        });
      }
      cursor = data?.cursor;
      if (!cursor) break;
    }
    return { payments: out, error: null };
  } catch (e) {
    return { payments: [], error: e instanceof Error ? e.message : "Square request failed" };
  }
}
