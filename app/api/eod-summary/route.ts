import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  managementEmailsDiag,
  usersEmailMap,
  facilityNamer,
  collectorSummary,
  renderDigest,
  sendResend,
  easternToday,
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

  let body: { collectorId?: string; test?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    /* no body is fine */
  }

  // Management may send for a chosen collector; anyone else sends their own day.
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const collectorId = me?.role === "management" && body.collectorId ? body.collectorId : user.id;

  // A test goes ONLY to the person testing (their own login email), so email
  // delivery can be verified independent of the management setup.
  let to: string[];
  if (body.test) {
    to = [user.email ?? ""].filter((e) => e.includes("@"));
    if (to.length === 0)
      return NextResponse.json(
        { error: "Your account has no email to send the test to." },
        { status: 400 }
      );
  } else {
    const { emails, mgmtCount } = await managementEmailsDiag(admin);
    to = emails;
    if (to.length === 0)
      return NextResponse.json(
        {
          error:
            mgmtCount === 0
              ? "No users are marked 'management'. Open Admin → Users and set at least one user's Role to 'management'."
              : `${mgmtCount} user(s) are marked 'management', but none has a login email on file to send to.`,
        },
        { status: 400 }
      );
  }

  const date = easternToday();
  const facName = await facilityNamer(admin);
  // Name fallback: the caller's own email (for their own summary), else look up.
  const emailOf =
    collectorId === user.id && user.email
      ? new Map([[user.id, user.email]])
      : await usersEmailMap(admin);
  const summary = await collectorSummary(admin, collectorId, date, facName, emailOf);

  try {
    await sendResend(
      to,
      `${body.test ? "[TEST] " : ""}End-of-Day — ${summary.name} · ${summary.worked} worked`,
      renderDigest([summary], date)
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "send failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, worked: summary.worked, recipients: to.length, test: !!body.test });
}
