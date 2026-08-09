import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { managementEmails, sendResend, easternToday } from "@/lib/report/eodSummary";
import { computeChiefBrief, renderChiefBrief } from "@/lib/report/chiefOfStaff";

// Manual "send now" for the Chief-of-Staff morning brief. Management only.
//   test: true  -> sends only to the caller (a preview). No one else emailed.
//   test: false -> sends to everyone marked "management".
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "management")
    return NextResponse.json({ error: "Management only." }, { status: 403 });
  if (!process.env.RESEND_API_KEY)
    return NextResponse.json({ error: "Email is not configured (RESEND_API_KEY missing)." }, { status: 503 });

  let body: { test?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    /* no body is fine */
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Notifications need SUPABASE_SERVICE_ROLE_KEY set on the server." },
      { status: 503 }
    );
  }

  const date = easternToday();
  const brief = await computeChiefBrief(admin);
  const html = renderChiefBrief(brief, date);

  const to = body.test
    ? [user.email ?? ""].filter((e) => e.includes("@"))
    : await managementEmails(admin);
  if (to.length === 0)
    return NextResponse.json(
      { error: body.test ? "Your account has no email." : "No management emails on file." },
      { status: 400 }
    );

  try {
    await sendResend(to, `${body.test ? "[TEST] " : ""}Chief of Staff — Morning Brief (${date})`, html);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "send failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, recipients: to.length, facilities: brief.facilities.length, test: !!body.test });
}
