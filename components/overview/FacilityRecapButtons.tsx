"use client";

import { useState } from "react";

// Management controls for the facility daily recap. "Preview to me" mails the
// caller a stacked preview of every facility's recap (no customer emailed);
// "Send facilities now" emails each facility its own recap immediately. Both
// also run automatically every day at 5:30 PM ET via cron.
export default function FacilityRecapButtons() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const post = (body: Record<string, unknown>) =>
    fetch("/api/facility-recap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json().then((d) => ({ ok: r.ok, d })));

  const run = async (test: boolean) => {
    // Real send: first show EXACTLY who it will reach and confirm.
    if (!test) {
      setBusy(true);
      setMsg("Checking recipients…");
      try {
        const { ok, d } = await post({ dryRun: true });
        if (!ok) {
          setMsg(`Error: ${d.error || "could not check recipients"}`);
          setBusy(false);
          return;
        }
        const facs = (d.facilities ?? []) as { name: string; emails: string[] }[];
        if (facs.length === 0) {
          setMsg("No facility has a login email — nothing would send. Set facility logins in Admin → Users.");
          setBusy(false);
          setTimeout(() => setMsg(""), 10000);
          return;
        }
        const lines = facs.map((f) => `• ${f.name} → ${f.emails.join(", ")}`).join("\n");
        const skipped = (d.skipped ?? []) as string[];
        const proceed = confirm(
          `This will email each facility ITS OWN recap to:\n\n${lines}\n\n` +
            `${d.managementCopied ?? 0} manager(s) BCC'd.` +
            (skipped.length ? `\n\nNo login (skipped): ${skipped.join(", ")}` : "") +
            `\n\nSend now?`
        );
        if (!proceed) {
          setMsg("Cancelled — nothing was sent.");
          setBusy(false);
          setTimeout(() => setMsg(""), 5000);
          return;
        }
      } catch {
        setMsg("Error: could not check recipients");
        setBusy(false);
        return;
      }
    }

    setMsg(test ? "Building preview…" : "Emailing facilities…");
    try {
      const { ok, d } = await post({ test });
      if (!ok) {
        setMsg(`Error: ${d.error || "could not send"}`);
      } else if (test) {
        setMsg(`✓ Preview emailed to you — ${d.facilities ?? 0} facilities. Check your inbox.`);
      } else {
        const skipped = (d.skipped ?? []) as string[];
        setMsg(
          `✓ Sent to ${d.sent ?? 0} facilities` +
            (d.managementCopied ? ` · ${d.managementCopied} manager(s) BCC'd` : "") +
            (skipped.length ? ` · ${skipped.length} had no login email: ${skipped.join(", ")}` : "")
        );
      }
    } catch {
      setMsg("Error: could not send");
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(""), 10000);
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
