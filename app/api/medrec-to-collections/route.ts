import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Shift a Medical Records row back to Collections: match its claim by patient +
// date of service (only when EXACTLY one claim matches), carry the record's note
// into that claim's Collections note, make the claim active on the board, then
// remove the med-records row. Management/staff only.
export const dynamic = "force-dynamic";

// "MCCARTHY, JAMES" and "James Mccarthy" → "james mccarthy".
const normName = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");

// A date string → "YYYY-MM-DD" (falls back to the trimmed raw text).
const dayKey = (v: unknown) => {
  const s = String(v ?? "").trim();
  const t = Date.parse(s);
  if (isNaN(t)) return s;
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "management" && me?.role !== "staff")
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  let body: { id?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* handled below */
  }
  if (!body.id) return NextResponse.json({ error: "Missing record id." }, { status: 400 });

  // Read the med record (RLS scopes this to the user's facilities).
  const { data: rec } = await supabase
    .from("medical_records")
    .select("id, facility_id, patient_name, dos_from, notes")
    .eq("id", body.id)
    .maybeSingle();
  if (!rec) return NextResponse.json({ error: "Record not found or not accessible." }, { status: 404 });
  if (!rec.facility_id) return NextResponse.json({ error: "This record has no facility set." }, { status: 400 });

  // Candidate claims in the same facility, matched on patient + DOS.
  const { data: cands } = await supabase
    .from("claims")
    .select("claim_id, patient_name, dos_from")
    .eq("facility_id", rec.facility_id)
    .eq("present", true);
  const pn = normName(rec.patient_name);
  const dk = dayKey(rec.dos_from);
  const matches = (cands ?? []).filter(
    (c: { patient_name: string | null; dos_from: string | null }) =>
      normName(c.patient_name) === pn && dayKey(c.dos_from) === dk
  );
  if (matches.length === 0)
    return NextResponse.json({
      ok: false,
      message: `No open Collections claim matches ${rec.patient_name || "this patient"} on ${rec.dos_from || "that DOS"}.`,
    });
  if (matches.length > 1)
    return NextResponse.json({
      ok: false,
      message: `${matches.length} claims match ${rec.patient_name} on ${rec.dos_from} — can't pick one automatically; handle it in Collections.`,
    });
  const claim = matches[0];

  // Carry the note into the claim's Collections note (append, don't clobber),
  // and make the claim active on the board again (un-resolve it).
  const { data: existing } = await supabase
    .from("claim_work")
    .select("notes")
    .eq("claim_id", claim.claim_id)
    .maybeSingle();
  const carried = String(rec.notes ?? "").trim();
  const stamped = carried ? `[From Medical Records] ${carried}` : "[Returned from Medical Records]";
  const prev = String(existing?.notes ?? "").trim();
  const newNotes = prev ? `${prev}\n${stamped}` : stamped;
  const { error: upErr } = await supabase.from("claim_work").upsert(
    {
      claim_id: claim.claim_id,
      notes: newNotes,
      resolved: false,
      resolved_at: null,
      resolved_by: null,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "claim_id" }
  );
  if (upErr)
    return NextResponse.json({ error: `Could not update the claim: ${upErr.message}` }, { status: 500 });

  // Remove the med-records row (its delete is management-only, so use the admin
  // client — access was already checked by the RLS read above).
  let removeErr: string | null = null;
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("medical_records").delete().eq("id", rec.id);
    if (error) removeErr = error.message;
  } catch {
    const { error } = await supabase.from("medical_records").delete().eq("id", rec.id);
    if (error) removeErr = error.message;
  }

  return NextResponse.json({
    ok: true,
    message: removeErr
      ? `Sent to Collections — ${claim.patient_name || claim.claim_id} (note added). Couldn't remove the med-records row: ${removeErr}`
      : `Sent to Collections — ${claim.patient_name || claim.claim_id}. Note carried over.`,
    claim_id: claim.claim_id,
    removed: !removeErr,
  });
}
