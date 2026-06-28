import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Creates (or invites) a Supabase auth user. Management-only. Uses the
// service-role key, which stays server-side and is never sent to the browser.
export async function POST(request: Request) {
  const supabase = createClient();

  // Authn + authz: caller must be signed in AND management.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { data: isMgmt } = await supabase.rpc("is_management");
  if (!isMgmt) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    email?: string;
    password?: string;
    full_name?: string;
    invite?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = (body.email ?? "").trim();
  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Invite-by-email (user sets their own password) or direct create with a
  // temporary password.
  if (body.invite) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: body.full_name ?? "" },
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, userId: data.user?.id });
  }

  if (!body.password || body.password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 }
    );
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: body.password,
    email_confirm: true,
    user_metadata: { full_name: body.full_name ?? "" },
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, userId: data.user?.id });
}
