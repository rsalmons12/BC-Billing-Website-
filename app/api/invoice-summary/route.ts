import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/supabase/page";
import { periodOf } from "@/lib/import/parseTrackers";
import type { Payment, Facility } from "@/lib/types";

// Owner-only. Returns EVERY facility's invoice for a month — collected, rate,
// amount due, and whether it has a recipient — so the invoice page can show the
// whole batch to verify before sending them all at once. Amounts use the SAME
// month/collected math as the single-facility send route, so the figure you
// verify here is exactly what goes out.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: me } = await supabase
    .from("profiles")
    .select("role, is_owner")
    .eq("id", user.id)
    .maybeSingle();
  if (me?.role !== "management" || me?.is_owner !== true)
    return NextResponse.json({ error: "Owners only." }, { status: 403 });

  let body: { month?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* month optional */
  }

  const { data: facRows } = await supabase
    .from("facilities")
    .select("id, name, short_name, billing_rate")
    .order("name");
  const facilities = (facRows ?? []) as Pick<
    Facility,
    "id" | "name" | "short_name" | "billing_rate"
  >[];

  // Who is marked "Invoices": facility logins (each gets its OWN facility's
  // invoice) and internal users (BCC on all). Loaded once, counted per facility.
  let facInvoiceProfiles: { id: string; facility_id: string | null }[] = [];
  let assignments: { profile_id: string; facility_id: string | null }[] = [];
  let internalCount = 0;
  try {
    const admin = createAdminClient();
    const [{ data: facProfs }, { data: asgs }, { data: internal }] = await Promise.all([
      admin
        .from("profiles")
        .select("id, facility_id")
        .eq("role", "facility")
        .eq("receives_invoices", true),
      admin.from("assignments").select("profile_id, facility_id"),
      admin.from("profiles").select("id").eq("receives_invoices", true).neq("role", "facility"),
    ]);
    facInvoiceProfiles = (facProfs ?? []) as typeof facInvoiceProfiles;
    assignments = (asgs ?? []) as typeof assignments;
    internalCount = (internal ?? []).length;
  } catch {
    /* recipient readiness unknown — treated as "internal copies only" below */
  }
  const facInvoiceIds = new Set(facInvoiceProfiles.map((p) => p.id));

  // Extra charges (late fees, adjustments) for the selected month, per facility.
  const chargesByFac = new Map<string, number>();
  if (body.month) {
    const { data: chg } = await supabase
      .from("invoice_charges")
      .select("facility_id, amount")
      .eq("period", body.month);
    for (const c of (chg ?? []) as { facility_id: string; amount: number }[])
      chargesByFac.set(c.facility_id, (chargesByFac.get(c.facility_id) ?? 0) + (Number(c.amount) || 0));
  }

  const payMonth = (p: Payment) =>
    periodOf(p.deposit_date ?? "", p.payment_entered ?? "", p.period ?? "");

  const safe = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);
  const monthSet = new Set<string>();

  const invoices = await Promise.all(
    facilities.map(async (f) => {
      const pays = await safe(
        selectAll<Payment>((from, to) =>
          supabase.from("payments").select("*").eq("facility_id", f.id).range(from, to)
        )
      );
      const byMonth = new Map<string, number>();
      for (const p of pays) {
        const m = payMonth(p);
        if (!m) continue;
        monthSet.add(m);
        byMonth.set(m, (byMonth.get(m) ?? 0) + (p.paid_amount ?? 0));
      }
      const collected = body.month ? byMonth.get(body.month) ?? 0 : 0;
      const rate = f.billing_rate;
      const baseFee =
        rate != null && rate > 0 ? Math.round(collected * (rate / 100) * 100) / 100 : 0;
      const extra = Math.round((chargesByFac.get(f.id) ?? 0) * 100) / 100;
      const fee = Math.round((baseFee + extra) * 100) / 100;

      // Facility logins marked "Invoices" for THIS facility (primary or assigned).
      let toCount = 0;
      for (const p of facInvoiceProfiles) if (p.facility_id === f.id) toCount++;
      for (const a of assignments)
        if (a.facility_id === f.id && facInvoiceIds.has(a.profile_id)) toCount++;

      const hasRate = rate != null && rate > 0;
      const hasRecipient = toCount > 0 || internalCount > 0;
      const issue = !hasRate
        ? "No Bill % set"
        : !hasRecipient
          ? 'No one marked "Invoices"'
          : "";

      return {
        facilityId: f.id,
        name: f.short_name || f.name,
        rate,
        collected,
        fee,
        toCount,
        internalCount,
        ready: hasRate && hasRecipient,
        issue,
      };
    })
  );

  const months = Array.from(monthSet).sort().reverse();
  return NextResponse.json({ ok: true, month: body.month ?? null, months, invoices });
}
