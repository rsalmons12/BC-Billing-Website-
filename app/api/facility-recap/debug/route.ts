import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/supabase/page";

// Diagnostic for the recap's "patients below reimbursement floor" list. Shows,
// per facility, the exact funnel: floors set → current census patients in
// PHP/IOP/OP → how many matched a real payment → how many came in below floor.
// Management only. Open /api/facility-recap/debug in the browser while logged in.
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
type Cen = {
  facility_id: string | null;
  level_of_care: string | null;
  week_start: string | null;
  patient_name: string | null;
  member_id: string | null;
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

  // Facilities + floors (tolerate the columns not existing).
  const { data: facs, error: facErr } = await admin
    .from("facilities")
    .select("id,name,short_name,php_floor,iop_floor,op_floor");
  if (facErr)
    return NextResponse.json({
      error: `Floor columns not found — run the 0040 migration. (${facErr.message})`,
    });

  const census = await selectAll<Cen>((f, t) =>
    admin.from("census").select("facility_id,level_of_care,week_start,patient_name,member_id").range(f, t)
  ).catch(() => []);
  const payments = await selectAll<Pay>((f, t) =>
    admin
      .from("payments")
      .select("facility_id,paid_amount,cpt_description,dos_from,dos_to,patient_name,member_id,deposit_date,payment_entered")
      .range(f, t)
  ).catch(() => []);

  const payDate = (p: Pay) => Date.parse(String(p.deposit_date || p.payment_entered || p.dos_from || "")) || 0;

  const out = (facs ?? []).map((f: {
    id: string; name: string; short_name: string | null;
    php_floor: number | null; iop_floor: number | null; op_floor: number | null;
  }) => {
    const floors: Record<LocFamily, number | null> = {
      PHP: f.php_floor ?? null,
      IOP: f.iop_floor ?? null,
      OP: f.op_floor ?? null,
    };
    const fCensus = census.filter((c) => c.facility_id === f.id && c.week_start);
    const latestWeek = fCensus.length
      ? fCensus.map((c) => c.week_start!).sort().slice(-1)[0]
      : null;
    const current = fCensus.filter((c) => c.week_start === latestWeek);
    const fPays = payments.filter((p) => p.facility_id === f.id);

    let inScope = 0;
    let matched = 0;
    let below = 0;
    const samples: unknown[] = [];
    for (const c of current) {
      const fam = locFamily(c.level_of_care);
      if (!fam) continue;
      inScope++;
      const floor = floors[fam];
      const cid = String(c.member_id ?? "").trim().toLowerCase();
      const cnm = normName(c.patient_name);
      const ms = fPays.filter((p) => {
        if ((p.paid_amount ?? 0) <= 0) return false;
        if (locFamily(p.cpt_description) !== fam) return false;
        const pid = String(p.member_id ?? "").trim().toLowerCase();
        if (cid && pid) return cid === pid;
        return normName(p.patient_name) === cnm && cnm !== "";
      });
      const hasMatch = ms.length > 0;
      if (hasMatch) matched++;
      let perDay: number | null = null;
      if (hasMatch) {
        ms.sort((a, b) => payDate(b) - payDate(a));
        const p = ms[0];
        perDay = Math.round((p.paid_amount ?? 0) / inclusiveDays(p.dos_from, p.dos_to));
        if (floor != null && floor > 0 && perDay < floor) below++;
      }
      if (samples.length < 8)
        samples.push({
          patient: c.patient_name,
          loc: fam,
          floor,
          hasMemberId: !!cid,
          matchedPayment: hasMatch,
          perDay,
          belowFloor: hasMatch && floor != null && perDay != null && perDay < floor,
        });
    }

    return {
      facility: f.short_name || f.name,
      floors,
      latestCensusWeek: latestWeek,
      currentCensusPatients: current.length,
      inPhpIopOp: inScope,
      matchedToPayment: matched,
      belowFloor: below,
      samples,
    };
  });

  return NextResponse.json({
    note: "For each facility: floors set, current census patients, how many are PHP/IOP/OP, how many matched a paid claim, and how many came in below the floor. If 'inPhpIopOp' is 0 the census has no current PHP/IOP/OP patients; if 'matchedToPayment' is 0 the census patients aren't linking to payments (member id / name mismatch).",
    facilities: out,
  });
}
