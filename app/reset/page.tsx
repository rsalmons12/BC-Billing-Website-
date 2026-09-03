"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Logo from "@/components/Logo";

// Where users land from the password-reset email. Supabase (the browser client,
// detectSessionInUrl) turns the link's token into a short-lived recovery
// session on load; we then let the user set a new password via updateUser.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    // Give the client a moment to exchange the recovery token in the URL, and
    // also catch the PASSWORD_RECOVERY event.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setHasSession(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
      setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (pw !== pw2) {
      setError("The two passwords don’t match.");
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      setDone(true);
      // Signed in via the recovery session — send them into the app shortly.
      setTimeout(() => {
        router.replace("/");
        router.refresh();
      }, 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t update the password.");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-command px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 ring-1 ring-command-border">
            <Logo size={44} />
          </div>
          <h1 className="font-display text-2xl font-bold text-command-text">Set a new password</h1>
          <p className="mt-1 text-sm text-command-muted">Recovery Desk</p>
        </div>

        <div className="rounded-2xl border border-command-border bg-command-surface p-6">
          {done ? (
            <p className="rounded-lg bg-gold/10 px-3 py-2 text-sm text-command-text">
              ✓ Password updated. Signing you in…
            </p>
          ) : !ready ? (
            <p className="text-sm text-command-muted">Loading…</p>
          ) : !hasSession ? (
            <div className="text-sm text-command-muted">
              This reset link is invalid or has expired. Go back to{" "}
              <a href="/login" className="font-semibold text-command-text underline">
                sign in
              </a>{" "}
              and tap “Forgot password?” to get a fresh link.
            </div>
          ) : (
            <form onSubmit={onSubmit}>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-command-muted">
                New password
              </label>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                className="mb-4 w-full rounded-lg border border-command-border bg-command px-3 py-2 text-sm text-command-text outline-none focus:border-gold"
              />
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-command-muted">
                Confirm new password
              </label>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                className="mb-4 w-full rounded-lg border border-command-border bg-command px-3 py-2 text-sm text-command-text outline-none focus:border-gold"
              />
              {error && (
                <p className="mb-4 rounded-lg bg-risk/10 px-3 py-2 text-sm text-risk">{error}</p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-gold px-3.5 py-2.5 text-sm font-semibold text-command transition hover:brightness-105 disabled:opacity-60"
              >
                {loading ? "Updating…" : "Update password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
