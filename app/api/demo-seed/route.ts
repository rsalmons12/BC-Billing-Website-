import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDemoFacility } from "@/lib/claims";

// Management-only: fill the DEMO facility (name ends with "(Demo)") with fake
// data across every tab the demo login sees — claims/AR, payments, billed,
// census, authorizations, negotiations — so the App Store review login shows a
// realistic, fully-populated app. Re-running replaces the demo data (idempotent)
// and never touches any real facility.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PATIENTS = [
  ["Jordan Avery", "Aetna", "W812440021"],
  ["Riley Bennett", "BCBS TX", "XJK556200"],
  ["Casey Morgan", "Cigna", "C99120034"],
  ["Taylor Brooks", "UnitedHealthcare", "U55018829"],
  ["Jamie Rivera", "Aetna", "W80233145"],
  ["Alex Sullivan", "Ambetter", "AMB771230"],
  ["Morgan Ellis", "BCBS IL", "XIL220091"],
  ["Drew Coleman", "Cigna", "C88450127"],
  ["Quinn Foster", "UnitedHealthcare", "U55620014"],
  ["Sydney Hayes", "Aetna", "W81990552"],
  ["Peyton Reed", "Molina", "MOL330218"],
  ["Reese Parker", "Horizon", "YHX3HZN5582"],
] as const;

const CPTS = [
  ["H0015", "IOP"],
  ["S0201", "PHP"],
  ["90853", "OP"],
] as const;

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const usdate = (d: Date) =>
  `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
const rnd = (min: number, max: number) => Math.round((min + Math.random() * (max - min)) * 100) / 100;
const pick = <T,>(a: readonly T[], i: number) => a[i % a.length];

export async function POST(request: Request) {
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
    return NextResponse.json(
      { error: "Seeding needs SUPABASE_SERVICE_ROLE_KEY set on the server." },
      { status: 503 }
    );
  }

  // Find the demo facility.
  const { data: facs } = await admin.from("facilities").select("id, name, short_name");
  const demo = ((facs ?? []) as { id: string; name: string; short_name: string | null }[]).find(
    (f) => isDemoFacility(f.name) || isDemoFacility(f.short_name)
  );
  if (!demo)
    return NextResponse.json(
      { error: 'No demo facility found. Create a facility whose name ends with "(Demo)" first.' },
      { status: 400 }
    );
  const fid = demo.id;

  const now = new Date();
  const thisMonth = ym(now);
  const lastMonth = ym(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  // Monday of the current week (for census).
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const weekStart = iso(monday);
  const weekDayIso = (i: number) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return iso(d);
  };

  const wipe = async (table: string) => {
    try {
      await admin.from(table).delete().eq("facility_id", fid);
    } catch {
      /* table may not exist in this deployment — skip */
    }
  };

  const summary: Record<string, number> = {};
  const insert = async (table: string, rows: Record<string, unknown>[]) => {
    if (!rows.length) return;
    const { error } = await admin.from(table).insert(rows);
    if (error) throw new Error(`${table}: ${error.message}`);
    summary[table] = (summary[table] ?? 0) + rows.length;
  };

  try {
    // ---- Claims (AR / Collections / 120+ / Overview) ----
    await wipe("claims");
    const claims = PATIENTS.flatMap(([name, payer, member], i) => {
      // 1–2 claims per patient with a spread of ages so buckets + 120+ populate.
      const n = 1 + (i % 2);
      return Array.from({ length: n }, (_, k) => {
        const age = [22, 48, 74, 96, 135, 210][(i + k) % 6];
        const charge = rnd(2200, 9800);
        const balance = Math.round(charge * (0.25 + 0.6 * Math.random()) * 100) / 100;
        const dos = new Date(now);
        dos.setDate(now.getDate() - age);
        const status = ["Claim At Payer", "Denied - Appeal", "In Review", "No Auth on File", "Paid - Partial"][
          (i + k) % 5
        ];
        return {
          claim_id: `DEMO-${1000 + i * 10 + k}`,
          facility_id: fid,
          patient_name: name,
          member_id: member,
          dos_from: iso(dos),
          dos_to: iso(dos),
          charge_amount: charge,
          balance,
          age_days: age,
          claim_status: `${payer} - ${status}`,
          present: true,
        };
      });
    });
    await insert("claims", claims);

    // ---- Payments (Payments tab) ----
    await wipe("payments");
    const payments = PATIENTS.flatMap(([name, payer, member], i) => {
      // A couple of paid lines each, split across this month and last.
      return [0, 1, 2].map((k) => {
        const [cpt, loc] = pick(CPTS, i + k);
        const inThisMonth = k < 2;
        const base = inThisMonth ? now : new Date(now.getFullYear(), now.getMonth() - 1, 15);
        const dep = new Date(base);
        dep.setDate(inThisMonth ? 3 + ((i + k) % 24) : 10 + (i % 15));
        const dos = new Date(dep);
        dos.setDate(dep.getDate() - 20);
        const charge = rnd(1800, 5200);
        return {
          facility_id: fid,
          deposit_date: usdate(dep),
          payment_entered: usdate(dep),
          patient_name: name,
          member_id: member,
          cpt_description: `${cpt} ${loc}`,
          payment_source: payer,
          dos_from: usdate(dos),
          dos_to: usdate(dos),
          charge_amount: charge,
          paid_amount: Math.round(charge * (0.45 + 0.4 * Math.random()) * 100) / 100,
          payment_type: k % 2 ? "EFT" : "Check",
          check_number: `${100000 + i * 7 + k}`,
          period: inThisMonth ? thisMonth : lastMonth,
          notes: "",
        };
      });
    });
    await insert("payments", payments);

    // ---- Billed claims (Billed tab) ----
    await wipe("billed_claims");
    const billed = PATIENTS.map(([name, payer], i) => {
      const [, loc] = pick(CPTS, i);
      const total = rnd(3200, 11000);
      const from = new Date(now.getFullYear(), now.getMonth(), 1 + (i % 20));
      return {
        facility_id: fid,
        claim_id: `DEMOB-${2000 + i}`,
        times_billed: 1,
        from_date: usdate(from),
        to_date: usdate(from),
        entered_date: usdate(now),
        total_amount: total,
        balance: Math.round(total * (0.2 + 0.5 * Math.random()) * 100) / 100,
        patient_name: name,
        payer_name: payer,
        payer_type: "Commercial",
        period: thisMonth,
        loc_units: { [loc]: 2 + (i % 4) },
      };
    });
    await insert("billed_claims", billed);

    // ---- Census (Census tab) — current week ----
    await wipe("census");
    const codeSets = [
      { Mon: "GN", Tue: "GN/CM", Wed: "GN", Thu: "GN", Fri: "GN" },
      { Mon: "GN/CM", Tue: "GN", Wed: "GN/PF", Fri: "GN" },
      { Mon: "GN", Tue: "GN/ID", Wed: "GN", Thu: "GN/PF", Fri: "GN" },
      { Tue: "GN", Thu: "GN", Fri: "GN/CM" },
    ];
    const dayName = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const census = PATIENTS.map(([name, payer, member], i) => {
      const loc = ["PHP MH 6", "IOP 3", "IOP MH 5", "PHP 6", "OP 2"][i % 5];
      const admit = new Date(now);
      admit.setDate(now.getDate() - (10 + i * 3));
      const set = codeSets[i % codeSets.length];
      const days: Record<string, string> = {};
      for (let d = 0; d < 7; d++) {
        const code = (set as Record<string, string>)[dayName[d]];
        if (code) days[weekDayIso(d)] = code;
      }
      return {
        facility_id: fid,
        week_start: weekStart,
        week_label: `Week of ${usdate(monday)}`,
        level_of_care: loc,
        patient_name: name,
        admit_date: usdate(admit),
        insurance: payer,
        member_id: member,
        auth: i % 3 === 0 ? "Approved" : "",
        days,
        paid_amount: i % 4 === 0 ? 0 : rnd(400, 3200),
        billing_status: "",
        notes: "",
      };
    });
    await insert("census", census);

    // ---- Authorizations (Authorization tab) ----
    await wipe("authorizations");
    const auths = PATIENTS.map(([name], i) => {
      const loc = ["PHP", "IOP", "OP"][i % 3];
      const start = new Date(now);
      start.setDate(now.getDate() - (14 + i * 2));
      const nextReview = new Date(now);
      nextReview.setDate(now.getDate() + [(-2 + i) % 12, 3, 6, 9][i % 4]);
      return {
        facility_id: fid,
        patient_name: name,
        admit_date: usdate(start),
        start_date: usdate(start),
        next_review_date: usdate(nextReview),
        auth_number: `AUTH-${5500 + i}`,
        level_of_care: loc,
        total_days: 10 + (i % 20),
        status: i % 5 === 0 ? "Pending" : "Approved",
        notes: "",
        discharged: false,
      };
    });
    await insert("authorizations", auths);

    // ---- Auth issues (Overview "Open Auth Issues" + Auth Issues tab) ----
    await wipe("auth_issues");
    const authIssues = PATIENTS.slice(0, 5).map(([name, payer], i) => {
      const dos = new Date(now);
      dos.setDate(now.getDate() - (30 + i * 6));
      return {
        facility_id: fid,
        claim_id: `DEMO-${1000 + i * 10}`,
        patient_name: name,
        payer,
        dos_from: usdate(dos),
        dos_to: usdate(dos),
        charge_amount: rnd(2400, 7800),
        status: i % 3 === 0 ? "Working" : "Not Worked",
        mgmt_needed: i === 0,
        notes: "",
        from_collection: true,
      };
    });
    await insert("auth_issues", authIssues);

    // ---- Negotiations (Negotiations tab) ----
    await wipe("negotiations");
    const negs = PATIENTS.slice(0, 8).map(([name, payer], i) => {
      const charged = rnd(6000, 22000);
      const proposed = Math.round(charged * (0.3 + 0.2 * Math.random()) * 100) / 100;
      const negotiated = i % 3 === 0 ? Math.round(proposed * 1.15 * 100) / 100 : null;
      const dos = new Date(now);
      dos.setDate(now.getDate() - (40 + i * 5));
      return {
        facility_id: fid,
        patient_name: name,
        dos: usdate(dos),
        vendor: ["Zelis", "MultiPlan", "Naviguard", "Data iSight"][i % 4],
        carrier: payer,
        charged_amount: charged,
        proposed_amount: proposed,
        negotiated_amount: negotiated,
        status: negotiated ? "Signed" : i % 2 ? "Pending" : "Open",
        notes: "",
      };
    });
    await insert("negotiations", negs);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Seeding failed.", seeded: summary },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, facility: demo.short_name || demo.name, seeded: summary });
}
