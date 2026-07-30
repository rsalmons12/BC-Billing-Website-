"use client";

import { useState } from "react";

// Management controls for the facility daily recap. "Preview to me" mails the
// caller a stacked preview of every facility's recap (no customer emailed);
// "Send facilities now" emails each facility its own recap immediately. Both
// also run automatically every day at 5:30 PM ET via cron.
export default function FacilityRecapButtons() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const run = async (test: boolean) => {
    setBusy(true);
    setMsg(test ? "Building preview…" : "Emailing facilities…");
    try {
      const res = await fetch("/api/facility-recap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(`Error: ${data.error || "could not send"}`);
      } else if (test) {
        setMsg(`✓ Preview emailed to you — ${data.facilities ?? 0} facilities. Check your inbox.`);
      } else {
        const skipped = (data.skipped ?? []) as string[];
        setMsg(
          `✓ Sent to ${data.sent ?? 0} facilities` +
            (skipped.length ? ` · ${skipped.length} had no login email: ${skipped.join(", ")}` : "")
        );
      }
    } catch {
      setMsg("Error: could not send");
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(""), 8000);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={() => run(true)}
        disabled={busy}
        className="badge bg-surface px-3 py-1.5 text-xs font-semibold text-surface-muted hover:bg-surface-card disabled:opacity-50"
        title="Email yourself a preview of every facility's recap (no facility is emailed)"
      >
        {busy ? "Working…" : "👁 Preview facility recap to me"}
      </button>
      <button
        onClick={() => run(false)}
        disabled={busy}
        className="badge bg-secured/12 px-3 py-1.5 text-xs font-semibold text-secured hover:bg-secured/20 disabled:opacity-50"
        title="Email every facility its own daily recap now"
      >
        {busy ? "Working…" : "✉ Send facilities their recap now"}
      </button>
      {msg && <span className="text-xs text-surface-muted">{msg}</span>}
    </div>
  );
}
