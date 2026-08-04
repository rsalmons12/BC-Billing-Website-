import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/page";

// One-time (repeatable) sweep: every present claim marked Med Rec = "Y" that
// isn't already in Medical Records gets a medical_records row. Deduped by
// facility + patient + DOS. Management/staff only.
export const dynamic = "force-dynamic";

const key = (fac: unknown, pat: unknown, dos: unknown) =>
  `${String(fac ?? "")}|${String(pat ?? "").trim().toLowerCase()}|${String(dos ?? "").trim()}`;

export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "management" && me?.role !== "staff")
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  // Claim ids flagged Med Rec = Y (with the collector note to carry over).
  const cw = await selectAll<{ claim_id: string; notes: string | null }>((f, t) =>
    supabase.from("claim_work").select("claim_id, notes").eq("med_rec", "Y").range(f, t)
  ).catch(() => []);
  if (cw.length === 0) return NextResponse.json({ ok: true, added: 0, alreadyThere: 0 });
  const noteOf = new Map(cw.map((x) => [x.claim_id, x.notes ?? ""]));
  const ids = cw.map((x) => x.claim_id);

  // The present claims behind those ids.
  type C = {
    claim_id: string;
    facility_id: string | null;
    patient_name: string | null;
    dos_from: string | null;
    dos_to: string | null;
    charge_amount: number | null;
    balance: number | null;
    claim_status: string | null;
  };
  const claims: C[] = [];
  for (let i = 0; i < ids.length; i += 400) {
    const { data } = await supabase
      .from("claims")
      .select("claim_id,facility_id,patient_name,dos_from,dos_to,charge_amount,balance,claim_status")
      .in("claim_id", ids.slice(i, i + 400))
      .eq("present", true);
    for (const c of (data as C[]) ?? []) claims.push(c);
  }

  // Everything already in Medical Records, to dedupe.
  const existing = await selectAll<{ facility_id: string | null; patient_name: string | null; dos_from: string | null }>(
    (f, t) => supabase.from("medical_records").select("facility_id,patient_name,dos_from").range(f, t)
  ).catch(() => []);
  const seen = new Set(existing.map((m) => key(m.facility_id, m.patient_name, m.dos_from)));

  const toInsert: Record<string, unknown>[] = [];
  for (const c of claims) {
    const k = key(c.facility_id, c.patient_name, c.dos_from);
    if (seen.has(k)) continue;
    seen.add(k);
    toInsert.push({
      facility_id: c.facility_id,
      patient_name: c.patient_name,
      dos_from: c.dos_from,
      dos_to: c.dos_to,
      charge_amount: c.balance ?? c.charge_amount,
      payer: c.claim_status,
      claim_status: c.claim_status,
      record_status: "Requested",
      notes: noteOf.get(c.claim_id) ?? "",
      updated_by: user.id,
    });
  }

  let added = 0;
  for (let i = 0; i < toInsert.length; i += 200) {
    const { error } = await supabase.from("medical_records").insert(toInsert.slice(i, i + 200));
    if (error) return NextResponse.json({ error: error.message, added }, { status: 500 });
    added += Math.min(200, toInsert.length - i);
  }

  return NextResponse.json({ ok: true, added, alreadyThere: claims.length - toInsert.length });
}
