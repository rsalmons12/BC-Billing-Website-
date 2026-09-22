"use client";

import { useState } from "react";

// Management-only: test / manually fire the weekly census text. A preview goes
// to a number you type; "Text all facilities now" sends each facility with an
// SMS number on file its own census summary.
type PlanRow = { facility: string; recipients: string[]; recipientCount: number };

export default function CensusTextActions({
  facilities = [],
}: {
  facilities?: { id: string; label: string }[];
}) {
  const [to, setTo] = useState("");
  const [facilityId, setFacilityId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [plan, setPlan] = useState<PlanRow[] | null>(null);
  const [mgmt, setMgmt] = useState<string[]>([]);

  const preview = async () => {
    setBusy(true);
    setMsg("Building preview…");
    setPlan(null);
    try {
      const res = await fetch("/api/census-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true, dryRun: true }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setPlan((d.plan as PlanRow[]) ?? []);
        setMgmt((d.managementNumbers as string[]) ?? []);
        setMsg("");
      } else {
        setMsg(`Error: ${d.error || "failed"}`);
      }
    } catch {
      setMsg("Error: could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

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
      {facilities.length > 0 && (
        <select
          value={facilityId}
          onChange={(e) => setFacilityId(e.target.value)}
          className="rounded-lg border border-surface-border bg-surface-card px-2 py-1.5 text-sm outline-none focus:border-brand-blue"
          title="Which facility's census to preview"
        >
          <option value="">First with census</option>
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      )}
      <input
        type="tel"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="preview → phone"
        className="w-40 rounded-lg border border-surface-border bg-surface-card px-2.5 py-1.5 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20"
      />
      <button
        onClick={() =>
          call(
            { to: to.trim(), facilityId: facilityId || undefined },
            "Sending preview…",
            (d) => `✓ Preview texted to ${d.sentTo}.`
          )
        }
        disabled={busy || !to.trim()}
        className="btn-ghost px-3 py-1.5 text-xs"
      >
        Send preview
      </button>
      <button
        onClick={preview}
        disabled={busy}
        className="btn-ghost px-3 py-1.5 text-xs"
        title="See exactly who would get each facility's text — no messages sent"
      >
        Preview recipients
      </button>
      <button
        onClick={() => {
          if (!confirm("Text every facility its OWN census summary now (its numbers + management)?")) return;
          call({ all: true }, "Sending…", (d) => `✓ Sent ${d.sent ?? 0} text(s).`);
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

      {plan && (
        <div className="mt-1 w-full">
          <div className="rounded-lg border border-surface-border bg-surface-card p-3 text-xs">
            <div className="mb-1 font-semibold text-surface-ink">
              Send plan — each facility gets ONLY its own census text
            </div>
            {mgmt.length > 0 && (
              <div className="mb-2 text-surface-muted">
                Management (gets every facility): {mgmt.join(", ")}
              </div>
            )}
            {plan.length === 0 ? (
              <div className="text-surface-muted">
                No facilities with both census data and a number on file.
              </div>
            ) : (
              <ul className="space-y-0.5">
                {plan.map((p) => (
                  <li key={p.facility} className="flex flex-wrap gap-x-2">
                    <span className="font-medium text-surface-ink">{p.facility}</span>
                    <span className="text-surface-muted">→ {p.recipients.join(", ")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
