"use client";

import { useState } from "react";

// Lightweight hub for the outgoing emails, so management can send/preview
// without waiting on a data-heavy page to load. All actions are simple POSTs.
export default function NotificationsClient() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Section
        title="Chief of Staff — morning brief"
        subtitle="What needs attention today across every facility: aging AR (100+ / 65–99), open auth issues, and census misses. Emailed to management automatically at 7:00 AM ET."
        actions={[
          { label: "✉ Email now to management", url: "/api/chief-of-staff", body: {}, primary: true },
          { label: "Send test to me", url: "/api/chief-of-staff", body: { test: true } },
        ]}
      />
      <Section
        title="End-of-day production summary"
        subtitle="Every collector's day, emailed to management. Runs automatically at 5:00 PM ET."
        actions={[
          { label: "✉ Email now to management", url: "/api/eod-summary", body: {}, primary: true },
          { label: "Send test to me", url: "/api/eod-summary", body: { test: true } },
        ]}
      />
      <Section
        title="Facility daily recaps"
        subtitle="Each facility's own recap to its login — management BCC'd. Runs automatically at 5:00 PM ET."
        actions={[
          { label: "👁 Preview to me (no facility emailed)", url: "/api/facility-recap", body: { test: true } },
          { label: "✉ Send facilities their recap now", url: "/api/facility-recap", body: {}, primary: true, confirm: "Email every facility that has a login their daily recap now?" },
        ]}
      />
    </div>
  );
}

type Action = {
  label: string;
  url: string;
  body: Record<string, unknown>;
  primary?: boolean;
  confirm?: string;
};

function Section({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions: Action[];
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const run = async (a: Action) => {
    // For the real facility send, show EXACTLY who it reaches and confirm first.
    const isFacilityRealSend = a.url === "/api/facility-recap" && !a.body.test;
    if (isFacilityRealSend) {
      setBusy(true);
      setMsg("Checking recipients…");
      try {
        const res = await fetch(a.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dryRun: true }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) {
          setMsg(`Error: ${d.error || "could not check recipients"}`);
          setBusy(false);
          return;
        }
        const facs = (d.facilities ?? []) as { name: string; emails: string[]; bcc?: string[] }[];
        if (facs.length === 0) {
          setMsg("No facility has a login email — nothing would send.");
          setBusy(false);
          setTimeout(() => setMsg(""), 10000);
          return;
        }
        const lines = facs
          .map((f) => {
            const bcc = (f.bcc ?? []).filter(Boolean);
            return `• ${f.name} → ${f.emails.join(", ")}${
              bcc.length ? `   (BCC: ${bcc.join(", ")})` : ""
            }`;
          })
          .join("\n");
        const skipped = (d.skipped ?? []) as string[];
        if (
          !confirm(
            `This will email each facility ITS OWN recap to:\n\n${lines}\n\n${
              d.managementCopied ?? 0
            } manager(s) BCC'd on every one.${skipped.length ? `\n\nNo login (skipped): ${skipped.join(", ")}` : ""}\n\nSend now?`
          )
        ) {
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
    } else if (a.confirm && !confirm(a.confirm)) {
      return;
    }
    setBusy(true);
    setMsg("Sending…");
    try {
      const res = await fetch(a.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(a.body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(`Error: ${data.error || "could not send"}`);
      } else if (data.preview) {
        setMsg(`✓ Preview emailed to you — ${data.facilities ?? 0} facilities. Check your inbox.`);
      } else if (typeof data.sent === "number") {
        const skipped = (data.skipped ?? []) as string[];
        setMsg(
          `✓ Sent to ${data.sent} facilit${data.sent === 1 ? "y" : "ies"}` +
            (data.managementCopied ? ` · ${data.managementCopied} manager(s) BCC'd` : "") +
            (skipped.length ? ` · ${skipped.length} had no login: ${skipped.join(", ")}` : "")
        );
      } else {
        setMsg(
          `✓ Emailed${data.recipients ? ` to ${data.recipients} recipient(s)` : ""}` +
            (typeof data.worked === "number" ? ` · ${data.worked} worked` : "")
        );
      }
    } catch {
      setMsg("Error: could not send");
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(""), 12000);
    }
  };

  return (
    <section className="card p-5">
      <div className="font-semibold">{title}</div>
      <p className="mt-0.5 text-sm text-surface-muted">{subtitle}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={() => run(a)}
            disabled={busy}
            className={`badge px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
              a.primary
                ? "bg-secured/12 text-secured hover:bg-secured/20"
                : "bg-surface text-surface-muted hover:bg-surface-card"
            }`}
          >
            {busy ? "Working…" : a.label}
          </button>
        ))}
      </div>
      {msg && <p className="mt-2 text-xs text-surface-ink">{msg}</p>}
    </section>
  );
}
