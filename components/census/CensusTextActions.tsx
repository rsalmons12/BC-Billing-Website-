"use client";

import { useState } from "react";

// Management-only: test / manually fire the weekly census text. A preview goes
// to a number you type; "Text all facilities now" sends each facility with an
// SMS number on file its own census summary.
export default function CensusTextActions() {
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const call = async (body: Record<string, unknown>, working: string, ok: (d: Record<string, unknown>) => string) => {
    setBusy(true);
    setMsg(working);
    try {
      const res = await fetch("/api/census-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      setMsg(res.ok ? ok(d) : `Error: ${d.error || "failed"}`);
    } catch {
      setMsg("Error: could not reach the server.");
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(""), 12000);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-surface-border bg-surface px-6 py-2 text-sm">
      <span className="text-xs font-semibold uppercase tracking-wide text-surface-muted">
        Census text
      </span>
      <input
        type="tel"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="preview → phone"
        className="w-40 rounded-lg border border-surface-border bg-surface-card px-2.5 py-1.5 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20"
      />
      <button
        onClick={() => call({ to: to.trim() }, "Sending preview…", (d) => `✓ Preview texted to ${d.sentTo}.`)}
        disabled={busy || !to.trim()}
        className="btn-ghost px-3 py-1.5 text-xs"
      >
        Send preview
      </button>
      <button
        onClick={() => {
          if (!confirm("Text every facility (with a number on file) its census summary now?")) return;
          call({ all: true }, "Sending…", (d) => `✓ Texted ${d.sent ?? 0} facilities.`);
        }}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-50"
      >
        ✉ Text all facilities now
      </button>
      <span className="text-xs text-surface-muted">
        Auto-sends weekly (Mon ~9 AM ET). Numbers set in Admin → Facilities.
      </span>
      {msg && <span className="text-xs font-medium text-secured">{msg}</span>}
    </div>
  );
}
