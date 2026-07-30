import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Read-only diagnostic for the end-of-day email. Tells us, in plain JSON,
// exactly why "no management email" happens: is anyone marked management, and
// can the server read their login email? Auth-gated to a logged-in management
// user (it exposes management login emails). No email is sent.
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const out: Record<string, unknown> = {
    you: { id: user.id, email: user.email, role: me?.role ?? null },
    hasResendKey: !!process.env.RESEND_API_KEY,
    hasCronSecret: !!process.env.CRON_SECRET,
  };

  if (me?.role !== "management")
    return NextResponse.json(
      { ...out, note: "Your account's Role is not 'management'. Set it in Admin → Users." },
      { status: 200 }
    );

  let admin;
  try {
    admin = createAdminClient();
    out.serviceRoleConfigured = true;
  } catch {
    return NextResponse.json(
      { ...out, serviceRoleConfigured: false, note: "SUPABASE_SERVICE_ROLE_KEY is not set on the server." },
      { status: 200 }
    );
  }

  // 0) Can the service-role client actually READ past row-level security?
  // A correct service_role key bypasses RLS and sees every row; the anon key
  // (a common misconfig) sees nothing without a user session.
  const { count: facCount, error: facErr } = await admin
    .from("facilities")
    .select("id", { count: "exact", head: true });
  const { count: profCount, error: allProfErr } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true });
  out.facilitiesReadable = facCount ?? 0;
  out.facilitiesReadError = facErr?.message ?? null;
  out.profilesReadable = profCount ?? 0;
  out.profilesReadError = allProfErr?.message ?? null;
  out.serviceRoleKeyLooksValid = (facCount ?? 0) > 0 || (profCount ?? 0) > 0;

  // 1) Who is marked management?
  const { data: mgmt, error: profErr } = await admin
    .from("profiles")
    .select("id, full_name, role")
    .eq("role", "management");
  out.managementProfilesError = profErr?.message ?? null;
  const ids = (mgmt ?? []).map((m: { id: string }) => m.id);
  out.managementProfileCount = ids.length;

  // 2) Can we read each one's login email via the admin auth API?
  const resolved: { id: string; name: string | null; email: string | null; error: string | null }[] = [];
  for (const m of (mgmt ?? []) as { id: string; full_name: string | null }[]) {
    try {
      const { data, error } = await admin.auth.admin.getUserById(m.id);
      resolved.push({
        id: m.id,
        name: m.full_name,
        email: data?.user?.email ?? null,
        error: error?.message ?? null,
      });
    } catch (e) {
      resolved.push({
        id: m.id,
        name: m.full_name,
        email: null,
        error: e instanceof Error ? e.message : "getUserById threw",
      });
    }
  }
  out.resolved = resolved;
  out.emailsResolved = resolved.filter((r) => r.email).length;

  out.verdict =
    ids.length === 0
      ? "No users are marked 'management'. Set at least one Role to 'management' in Admin → Users."
      : resolved.some((r) => r.email)
        ? "OK — the summary has at least one management email to send to."
        : "Management users exist, but the server could not read any of their login emails (auth admin API problem).";

  return NextResponse.json(out, { status: 200 });
}
