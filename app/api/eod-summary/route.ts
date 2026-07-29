import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  managementEmails,
  facilityNamer,
  collectorSummary,
  renderDigest,
  sendResend,
} from "@/lib/report/eodSummary";

// Manual "send now" for the end-of-day summary. Recipients are resolved from
// the management accounts (their login emails) — nothing is preset or typed.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!process.env.RESEND_API_KEY)
    return NextResponse.json({ error: "Email is not configured (RESEND_API_KEY missing)." }, { status: 503 });

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Notifications need SUPABASE_SERVICE_ROLE_KEY set on the server." },
      { status: 503 }
    );
  }

  let body: { collectorId?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* no body is fine */
  }

  // Management may send for a chosen collector; anyone else sends their own day.
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const collectorId = me?.role === "management" && body.collectorId ? body.collectorId : user.id;

  const to = await managementEmails(admin);
  if (to.length === 0)
    return NextResponse.json(
      { error: "No management emails on file — mark at least one user as management in Admin." },
      { status: 400 }
    );

  const date = new Date().toISOString().slice(0, 10);
  const facName = await facilityNamer(admin);
  const summary = await collectorSummary(admin, collectorId, date, facName);

  try {
    await sendResend(
      to,
      `End-of-Day — ${summary.name} · ${summary.worked} worked`,
      renderDigest([summary], date)
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "send failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, worked: summary.worked, recipients: to.length });
}
