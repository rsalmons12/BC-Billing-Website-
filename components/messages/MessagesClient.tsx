"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import type { Facility, FacilityMessage } from "@/lib/types";

export default function MessagesClient({
  facilities,
  canSend,
}: {
  facilities: Facility[];
  canSend: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [facilityId, setFacilityId] = useState(facilities[0]?.id ?? "");
  const [allMessages, setAllMessages] = useState<FacilityMessage[]>([]);
  const [loading, setLoading] = useState(true);

  // composer
  const [claimId, setClaimId] = useState("");
  const [patient, setPatient] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Pre-fill the composer to reply to a specific message.
  const startReply = (m: FacilityMessage) => {
    if (m.facility_id) setFacilityId(m.facility_id);
    const s = m.subject ?? "";
    setSubject(s.toLowerCase().startsWith("re:") ? s : s ? `Re: ${s}` : "Re:");
    if (m.claim_id) setClaimId(m.claim_id);
    if (m.patient_name) setPatient(m.patient_name);
    setTimeout(() => bodyRef.current?.focus(), 50);
  };

  const facility = facilities.find((f) => f.id === facilityId);
  const facName = useCallback(
    (id: string | null) => {
      const f = facilities.find((x) => x.id === id);
      return f?.short_name || f?.name || "Unknown facility";
    },
    [facilities]
  );

  // Load EVERY message we can see (RLS scopes it). Inbox + per-facility thread
  // are both derived from this.
  const load = useCallback(async () => {
    try {
      const rows = await selectAll<FacilityMessage>((f, t) =>
        supabase
          .from("facility_messages")
          .select("*")
          .order("created_at", { ascending: false })
          .range(f, t)
      );
      setAllMessages(rows);
    } catch {
      setAllMessages([]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
    // Auto-refresh so replies appear without a manual reload.
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, [load]);

  const thread = useMemo(
    () => allMessages.filter((m) => m.facility_id === facilityId),
    [allMessages, facilityId]
  );
  const inboundCount = useMemo(
    () => allMessages.filter((m) => m.direction === "inbound").length,
    [allMessages]
  );

  const send = async () => {
    if (!bodyText.trim()) {
      setNote("Write a message first.");
      return;
    }
    setSending(true);
    setNote("Sending…");
    const res = await fetch("/api/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        facility_id: facilityId,
        claim_id: claimId.trim() || null,
        patient_name: patient.trim() || null,
        subject: subject.trim(),
        message: bodyText.trim(),
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSending(false);
    if (!res.ok) {
      setNote(`❌ ${json.error || "Could not send."}`);
      return;
    }
    setNote("✓ Sent");
    setClaimId("");
    setPatient("");
    setSubject("");
    setBodyText("");
    load();
    setTimeout(() => setNote(""), 2500);
  };

  return (
    <div className="flex h-full min-h-0">
      {/* ---------- INBOX (all messages, newest first) ---------- */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-surface-border bg-surface">
        <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
          <span className="font-display font-bold">📥 Inbox</span>
          <button
            onClick={load}
            className="badge bg-surface-card px-2 py-1 text-[11px] text-surface-muted hover:bg-surface"
            title="Refresh"
          >
            ↻
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {loading && (
            <p className="p-4 text-xs text-surface-muted">Loading…</p>
          )}
          {!loading && allMessages.length === 0 && (
            <p className="p-4 text-xs text-surface-muted">
              No messages yet. Replies from facilities will land here.
            </p>
          )}
          {allMessages.map((m) => (
            <button
              key={m.id}
              onClick={() => m.facility_id && setFacilityId(m.facility_id)}
              className={`block w-full border-b border-surface-border px-4 py-2.5 text-left hover:bg-surface-card ${
                m.facility_id === facilityId ? "bg-surface-card" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">
                  {m.direction === "inbound" ? "↩ " : "→ "}
                  {facName(m.facility_id)}
                </span>
                {m.direction === "inbound" && (
                  <span className="badge bg-brand-blue/15 px-1.5 py-0.5 text-[10px] text-brand-blue">
                    reply
                  </span>
                )}
              </div>
              <div className="truncate text-[11px] text-surface-muted">
                {m.subject || m.body || "(no text)"}
              </div>
              <div className="text-[10px] text-surface-muted">
                {new Date(m.created_at).toLocaleString()}
                {m.direction === "outbound" && m.sender_name?.trim()
                  ? ` · by ${m.sender_name}`
                  : ""}
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* ---------- main: composer + thread ---------- */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* toolbar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-surface-border bg-surface-card px-6 py-3">
          <select
            value={facilityId}
            onChange={(e) => setFacilityId(e.target.value)}
            className="input max-w-[18rem]"
          >
            {facilities.length === 0 && <option value="">No facilities</option>}
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.short_name || f.name}
              </option>
            ))}
          </select>
          {facility && (
            <span className="text-xs text-surface-muted">
              {facility.email ? (
                <>
                  Emails go to{" "}
                  <b className="text-surface-ink">
                    {facility.email
                      .split(/[,;\s]+/)
                      .filter((e) => e.includes("@"))
                      .join(", ")}
                  </b>
                </>
              ) : (
                <span className="text-risk">
                  No email on file — add one in Admin → Facilities.
                </span>
              )}
            </span>
          )}
          <span className="ml-auto text-xs text-surface-muted">
            {inboundCount} repl{inboundCount === 1 ? "y" : "ies"} received
          </span>
          {note && <span className="text-xs font-medium text-secured">{note}</span>}
        </div>

        <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] md:grid-cols-2 md:grid-rows-1">
          {/* composer */}
          {canSend && (
            <div className="border-b border-surface-border p-6 md:border-b-0 md:border-r">
              <h3 className="font-display font-bold">Email this facility</h3>
              <p className="mt-1 text-xs text-surface-muted">
                Sends a real email (with the Collections Department / HIPAA
                signature). Their reply lands in the Inbox on the left.
              </p>
              <div className="mt-4 space-y-3">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <span className="label">Claim ID (optional)</span>
                    <input
                      value={claimId}
                      onChange={(e) => setClaimId(e.target.value)}
                      className="input"
                      placeholder="e.g. 123456"
                    />
                  </div>
                  <div className="flex-1">
                    <span className="label">Patient (optional)</span>
                    <input
                      value={patient}
                      onChange={(e) => setPatient(e.target.value)}
                      className="input"
                      placeholder="Last, First"
                    />
                  </div>
                </div>
                <div>
                  <span className="label">Subject</span>
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="input"
                    placeholder="Inactive policy on a claim"
                  />
                </div>
                <div>
                  <span className="label">Message</span>
                  <textarea
                    ref={bodyRef}
                    value={bodyText}
                    onChange={(e) => setBodyText(e.target.value)}
                    rows={6}
                    className="input resize-none"
                    placeholder="Hi — the policy came back inactive for the patient on claim #…"
                  />
                </div>
                <button
                  onClick={send}
                  disabled={sending || !facility?.email}
                  className="btn-primary w-full disabled:opacity-60"
                >
                  {sending ? "Sending…" : "✉ Send email"}
                </button>
              </div>
            </div>
          )}

          {/* thread */}
          <div className="min-h-0 overflow-auto p-6">
            <h3 className="font-display font-bold">
              Conversation — {facility?.short_name || facility?.name || "—"}
            </h3>
            {!loading && thread.length === 0 && (
              <p className="mt-4 text-sm text-surface-muted">
                No messages with this facility yet.
              </p>
            )}
            <div className="mt-4 space-y-3">
              {thread.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-xl border p-3 text-sm ${
                    m.direction === "inbound"
                      ? "border-brand-blue/30 bg-brand-blue/5"
                      : "border-surface-border bg-surface-card"
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between text-[11px] text-surface-muted">
                    <span className="font-semibold">
                      {m.direction === "inbound"
                        ? "↩ Facility reply"
                        : `→ Sent by ${m.sender_name?.trim() || "—"}`}
                      {m.claim_id ? ` · claim ${m.claim_id}` : ""}
                      {m.patient_name ? ` · ${m.patient_name}` : ""}
                    </span>
                    <span>{new Date(m.created_at).toLocaleString()}</span>
                  </div>
                  {m.subject && <div className="font-semibold">{m.subject}</div>}
                  <div className="whitespace-pre-wrap">{m.body}</div>
                  {canSend && (
                    <button
                      onClick={() => startReply(m)}
                      className="mt-2 badge bg-command px-2.5 py-1 text-[11px] font-semibold text-command-text"
                    >
                      ↩ Reply
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
