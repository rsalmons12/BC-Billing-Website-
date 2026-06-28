import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_URL } from "@/lib/supabase/config";
import Header from "@/components/Header";

export default async function PendingPage() {
  const { profile, email, userId } = await requireProfile();

  // Diagnostic: read this user's profile row directly so we can tell the
  // difference between "no profile row" and "row exists but role is pending".
  const supabase = createClient();
  const { data: rawProfile, error } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", userId)
    .maybeSingle();

  const projectRef =
    SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? "unknown";

  return (
    <>
      <Header profile={profile} email={email} subtitle="Welcome" />
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4">
          <div className="card p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gold/15 text-2xl text-gold">
              ⏳
            </div>
            <h1 className="mb-2 text-xl font-bold">Access not set up yet</h1>
            <p className="text-sm text-surface-muted">
              Your account has been created but a role hasn&apos;t been assigned.
              Please contact management to get access to Recovery Desk.
            </p>
            <form action="/auth/signout" method="post" className="mt-6">
              <button className="btn-ghost w-full" type="submit">
                Sign out
              </button>
            </form>
          </div>

          {/* Diagnostic panel — read these values aloud to support */}
          <div className="card bg-command p-4 font-mono text-xs text-command-text">
            <div className="mb-2 font-bold text-gold">DIAGNOSTIC</div>
            <div>project: {projectRef}</div>
            <div className="break-all">your email: {email ?? "—"}</div>
            <div className="break-all">your user id: {userId}</div>
            <div>
              profile row found: {rawProfile ? "yes" : "NO"}
            </div>
            <div>role in db: {rawProfile?.role ?? "(none)"}</div>
            {error && <div className="text-risk">read error: {error.message}</div>}
          </div>
        </div>
      </main>
    </>
  );
}
