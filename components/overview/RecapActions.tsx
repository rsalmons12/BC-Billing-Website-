"use client";

import { useState } from "react";

// Management-only actions on the Network Overview banner: preview a facility
// recap to yourself, or send every facility their recap. Hidden for facility /
// staff logins (they can't send recaps).
export default function RecapActions() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [demoTo, setDemoTo] = useState("");

  const call = async (
    body: Record<string, unknown>,
    opts?: { confirmText?: string; okMsg?: (d: Record<string, unknown>) => string; workingMsg?: string }
  ) => {
    if (opts?.confirmText && !window.confirm(opts.confirmText)) return;
    setBusy(true);
    setMsg(opts?.workingMsg ?? (opts?.confirmText ? "Sending…" : "Preparing preview…"));
    try {
      const res = await fetch("/api/facility-recap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      setMsg(
        res.ok
          ? opts?.okMsg
            ? opts.okMsg(d)
            : opts?.confirmText
              ? `✓ Sent to ${d.facilities ?? 0} facility recap(s).`
              : `✓ Preview emailed to you (${d.facilities ?? 0} facilities).`
          : `Error: ${d.error || "failed"}`
      );
    } catch {
      setMsg("Error: could not reach the server.");
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(""), 12000);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => call({ test: true })}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-command/30 bg-command/5 px-3 py-1.5 text-sm font-semibold text-command hover:bg-command/10 disabled:opacity-50"
      >
        👁 Preview facility recap
      </button>
      <span className="inline-flex items-center gap-1.5">
        <input
          type="email"
          value={demoTo}
          onChange={(e) => setDemoTo(e.target.value)}
          placeholder="demo → email (blank = me)"
          className="w-52 rounded-lg border border-surface-border bg-surface-card px-2.5 py-1.5 text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/20"
        />
        <button
          onClick={() =>
            call(
              { demo: true, to: demoTo.trim() },
              {
                workingMsg: "Sending demo…",
                okMsg: (d) => `✓ Demo daily recap sent to ${d.sentTo ?? "you"}.`,
              }
            )
          }
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-green/40 bg-brand-green/10 px-3 py-1.5 text-sm font-semibold text-brand-green hover:bg-brand-green/15 disabled:opacity-50"
        >
          🎬 Send demo daily recap
        </button>
      </span>
      <button
        onClick={() =>
          call(
            {},
            { confirmText: "Send every facility their recap now? This emails all facilities." }
          )
        }
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 hover:shadow-brand disabled:opacity-50"
      >
        ✉ Send facilities their recap
      </button>
      {msg && <span className="text-xs text-surface-ink">{msg}</span>}
    </div>
  );
}
