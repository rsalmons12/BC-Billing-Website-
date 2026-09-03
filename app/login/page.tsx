"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Logo from "@/components/Logo";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function onForgot() {
    setError(null);
    setNotice(null);
    const addr = email.trim();
    if (!addr) {
      setError("Enter your email above first, then tap “Forgot password?”.");
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      await supabase.auth.resetPasswordForEmail(addr, {
        redirectTo: `${window.location.origin}/reset`,
      });
      // Always show the same message (don't reveal whether an account exists).
      setNotice(`If an account exists for ${addr}, a password-reset link is on its way. Check your email.`);
    } catch {
      setNotice(`If an account exists for ${addr}, a password-reset link is on its way. Check your email.`);
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // Every user must accept the Privacy Policy + HIPAA notice before access.
    if (!agreed) {
      setError("Please read and agree to the Privacy Policy and HIPAA Notice to continue.");
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      // Fail fast instead of spinning forever if the Supabase host is
      // unreachable or the env keys are wrong.
      const timeout = new Promise<{ error: { message: string } }>((resolve) =>
        setTimeout(
          () =>
            resolve({
              error: {
                message:
                  "Couldn't reach the server. Check your connection and try again.",
              },
            }),
          15000
        )
      );
      const { error } = await Promise.race([
        supabase.auth.signInWithPassword({ email: email.trim(), password }),
        timeout,
      ]);
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong signing in. Please try again."
      );
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-command p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 ring-1 ring-command-border">
            <Logo size={44} />
          </div>
          <h1 className="font-display text-2xl font-bold text-command-text">
            BC Billing Solutions
          </h1>
          <p className="mt-1 text-sm text-command-muted">Recovery Desk</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-command-border bg-command-surface p-6"
        >
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-command-muted">
            Email
          </label>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mb-4 w-full rounded-lg border border-command-border bg-command px-3 py-2 text-sm text-command-text outline-none focus:border-gold"
          />

          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-command-muted">
            Password
          </label>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mb-4 w-full rounded-lg border border-command-border bg-command px-3 py-2 text-sm text-command-text outline-none focus:border-gold"
          />

          <label className="mb-4 flex items-start gap-2 text-xs leading-snug text-command-muted">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-gold"
            />
            <span>
              I have read and agree to the{" "}
              <a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-command-text underline"
              >
                Privacy Policy
              </a>{" "}
              and{" "}
              <a
                href="/hipaa"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-command-text underline"
              >
                HIPAA Notice
              </a>
              . This system contains PHI; I will access it only for authorized work.
            </span>
          </label>

          {error && (
            <p className="mb-4 rounded-lg bg-risk/10 px-3 py-2 text-sm text-risk">
              {error}
            </p>
          )}
          {notice && (
            <p className="mb-4 rounded-lg bg-gold/10 px-3 py-2 text-sm text-command-text">
              {notice}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !agreed}
            className="w-full rounded-lg bg-gold px-3.5 py-2.5 text-sm font-semibold text-command transition hover:brightness-105 disabled:opacity-60"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>

          <button
            type="button"
            onClick={onForgot}
            disabled={loading}
            className="mt-3 w-full text-center text-xs font-semibold text-command-muted underline hover:text-command-text disabled:opacity-60"
          >
            Forgot password?
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-command-muted">
          New accounts start as <span className="text-command-text">pending</span>.
          Management assigns your access.
        </p>
      </div>
    </div>
  );
}
