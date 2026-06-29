"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Logo from "@/components/Logo";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
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

          {error && (
            <p className="mb-4 rounded-lg bg-risk/10 px-3 py-2 text-sm text-risk">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-gold px-3.5 py-2.5 text-sm font-semibold text-command transition hover:brightness-105 disabled:opacity-60"
          >
            {loading ? "Signing in…" : "Sign in"}
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
