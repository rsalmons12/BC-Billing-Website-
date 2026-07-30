"use client";

import { useState } from "react";

// Facility-side "email me my recap": a facility login sends itself the same
// daily recap it receives automatically at 5:30 PM ET, to its own login email.
// Useful for verifying the facility experience end-to-end.
export default function MyRecapButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const send = async () => {
    setBusy(true);
    setMsg("Sending…");
    try {
      const res = await fetch("/api/facility-recap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      setMsg(
        res.ok
          ? "✓ Emailed to you — check your inbox (and spam)."
          : `Error: ${data.error || "could not send"}`
      );
    } catch {
      setMsg("Error: could not send");
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(""), 8000);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={send}
        disabled={busy}
        className="badge bg-secured/12 px-3 py-1.5 text-xs font-semibold text-secured hover:bg-secured/20 disabled:opacity-50"
        title="Email yourself your daily recap now"
      >
        {busy ? "Sending…" : "✉ Email me my recap"}
      </button>
      {msg && <span className="text-xs text-surface-muted">{msg}</span>}
    </div>
  );
}
