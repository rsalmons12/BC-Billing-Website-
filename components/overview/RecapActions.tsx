"use client";

import { useState } from "react";

// Management-only actions on the Network Overview banner: preview a facility
// recap to yourself, or send every facility their recap. Hidden for facility /
// staff logins (they can't send recaps).
export default function RecapActions() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const call = async (body: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setMsg(confirmText ? "Sending…" : "Preparing preview…");
    try {
      const res = await fetch("/api/facility-recap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      setMsg(
        res.ok
          ? confirmText
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
      <button
        onClick={() =>
          call({}, "Send every facility their recap now? This emails all facilities.")
        }
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg bg-command px-3 py-1.5 text-sm font-semibold text-command-text hover:brightness-110 disabled:opacity-50"
      >
        ✉ Send facilities their recap
      </button>
      {msg && <span className="text-xs text-surface-ink">{msg}</span>}
    </div>
  );
}
