import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  managementEmailsDiag,
  usersEmailMap,
  facilityNamer,
  collectorSummary,
  buildTeamDigest,
  renderDigest,
  sendResend,
  easternToday,
  type CollectorSummary,
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

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const isMgmt = me?.role === "management";
  const date = easternToday();

  // ---- Recipients ---------------------------------------------------------
  // A test goes ONLY to the person testing (their own login email), so email
  // delivery can be verified independent of the management setup. Everything
  // else goes to the accounts marked "management".
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

  // ---- Content ------------------------------------------------------------
  // Management (real send) gets the WHOLE team's day — the same digest the
  // 5 PM cron sends — so a manager never has to pick a collector to see the
  // numbers. A test, or a non-management collector, gets that one person's day.
  let summaries: CollectorSummary[];
  let subject: string;
  if (isMgmt && !body.test) {
    summaries = await buildTeamDigest(admin, date);
    const totWorked = summaries.reduce((s, c) => s + c.worked, 0);
    subject = `End-of-Day Production — ${totWorked} claims worked across ${summaries.length} collector${
      summaries.length === 1 ? "" : "s"
    }`;
  } else {
    const facName = await facilityNamer(admin);
    // Name fallback: the caller's own email, else look up in auth.
    const emailOf =
      user.email ? new Map([[user.id, user.email]]) : await usersEmailMap(admin);
    const summary = await collectorSummary(admin, user.id, date, facName, emailOf);
    summaries = [summary];
    subject = `${body.test ? "[TEST] " : ""}End-of-Day — ${summary.name} · ${summary.worked} worked`;
  }

  try {
    await sendResend(to, subject, renderDigest(summaries, date));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "send failed" }, { status: 502 });
  }
  return NextResponse.json({
    ok: true,
    collectors: summaries.length,
    worked: summaries.reduce((s, c) => s + c.worked, 0),
    recipients: to.length,
    test: !!body.test,
  });
}
