import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/supabase/page";

// Diagnostic for the recap's "patients below reimbursement floor" list, which
// reads straight from the PAYMENT UPLOADS. Per facility it shows: floors set →
// paid PHP/IOP/OP payments → distinct patients → how many came in below floor,
// with samples. Management only. Open /api/facility-recap/debug while logged in.
export const dynamic = "force-dynamic";

type LocFamily = "PHP" | "IOP" | "OP";
function locFamily(loc: unknown): LocFamily | null {
  const u = String(loc ?? "").toUpperCase();
  if (/\bIOP\b/.test(u) || /H0015|S9480/.test(u)) return "IOP";
  if (/\bPHP\b/.test(u) || /PARTIAL/.test(u) || /S0201|H0035/.test(u)) return "PHP";
  if (/\bOP\b/.test(u) || /OUTPATIENT/.test(u) || /90853/.test(u)) return "OP";
  return null;
}
function normName(s: unknown): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");
}
function inclusiveDays(from: unknown, to: unknown): number {
  const a = Date.parse(String(from ?? ""));
  const b = Date.parse(String(to ?? ""));
  if (isNaN(a)) return 1;
  if (isNaN(b) || b < a) return 1;
  return Math.round((b - a) / 86400000) + 1;
}

type Pay = {
  facility_id: string | null;
  paid_amount: number | null;
  cpt_description: string | null;
  dos_from: string | null;
  dos_to: string | null;
  patient_name: string | null;
  member_id: string | null;
  deposit_date: string | null;
  payment_entered: string | null;
};

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "management")
    return NextResponse.json({ error: "Management only." }, { status: 403 });

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set." }, { status: 503 });
  }

  const { data: facs, error: facErr } = await admin
    .from("facilities")
    .select("id,name,short_name,php_floor,iop_floor,op_floor");
  if (facErr)
    return NextResponse.json({
      error: `Floor columns not found — run the 0040 migration. (${facErr.message})`,
    });

  const payments = await selectAll<Pay>((f, t) =>
    admin
      .from("payments")
      .select("facility_id,paid_amount,cpt_description,dos_from,dos_to,patient_name,member_id,deposit_date,payment_entered")
      .range(f, t)
  ).catch(() => []);

  const payDate = (p: Pay) => Date.parse(String(p.deposit_date || p.payment_entered || p.dos_from || "")) || 0;
  const cutoffMs = Date.now() - 60 * 86400000; // last 60 days only

  const out = (facs ?? []).map((f: {
    id: string; name: string; short_name: string | null;
    php_floor: number | null; iop_floor: number | null; op_floor: number | null;
  }) => {
    const floors: Record<LocFamily, number | null> = {
      PHP: f.php_floor ?? null,
      IOP: f.iop_floor ?? null,
      OP: f.op_floor ?? null,
    };
    const fPays = payments.filter((p) => p.facility_id === f.id);

    // Most recent paid PHP/IOP/OP payment per (patient + level of care).
    const latest = new Map<string, { patient: string; loc: LocFamily; pay: Pay }>();
    let paidLocPayments = 0;
    for (const p of fPays) {
      if ((p.paid_amount ?? 0) <= 0) continue;
      if (payDate(p) < cutoffMs) continue; // last 60 days only
      const fam = locFamily(p.cpt_description);
      if (!fam) continue;
      paidLocPayments++;
      const idKey = String(p.member_id ?? "").trim().toLowerCase() || normName(p.patient_name);
      if (!idKey) continue;
      const key = `${idKey}|${fam}`;
      const prev = latest.get(key);
      if (!prev || payDate(p) > payDate(prev.pay))
        latest.set(key, { patient: String(p.patient_name ?? "").trim() || "—", loc: fam, pay: p });
    }

    let below = 0;
    const samples: unknown[] = [];
    for (const { patient, loc, pay } of latest.values()) {
      const floor = floors[loc];
      const perDay = Math.round((pay.paid_amount ?? 0) / inclusiveDays(pay.dos_from, pay.dos_to));
      const isBelow = floor != null && floor > 0 && perDay > 0 && perDay < floor;
      if (isBelow) below++;
      if (samples.length < 10) samples.push({ patient, loc, floor, perDay, belowFloor: isBelow });
    }

    return {
      facility: f.short_name || f.name,
      floors,
      paidLocPayments,
      distinctPatients: latest.size,
      belowFloor: below,
      samples,
    };
  });

  return NextResponse.json({
    note: "Reads straight from payment uploads, LAST 60 DAYS only. Per facility: floors set, count of paid PHP/IOP/OP payments in the window, distinct patients, and how many came in below floor. If paidLocPayments is 0, there are no paid PHP/IOP/OP payments in the last 60 days for that facility (check the CPT on the uploads: S0201/H0035=PHP, H0015/S9480=IOP, 90853=OP). If floors are null, set them in Admin.",
    facilities: out,
  });
}
