"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [messages, setMessages] = useState<FacilityMessage[]>([]);
  const [loading, setLoading] = useState(true);

  // composer
  const [claimId, setClaimId] = useState("");
  const [patient, setPatient] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState("");

  const facility = facilities.find((f) => f.id === facilityId);

  const load = useCallback(async () => {
    if (!facilityId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await selectAll<FacilityMessage>((f, t) =>
        supabase
          .from("facility_messages")
          .select("*")
          .eq("facility_id", facilityId)
          .order("created_at", { ascending: false })
          .range(f, t)
      );
      setMessages(rows);
    } catch {
      // Table may not exist yet (migration 0012 not run) — show empty, no crash.
      setMessages([]);
    }
    setLoading(false);
  }, [supabase, facilityId]);

  useEffect(() => {
    load();
  }, [load]);

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
    <div className="flex h-full flex-col">
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
              <>Emails go to <b className="text-surface-ink">{facility.email}</b></>
            ) : (
              <span className="text-risk">
                No email on file — add one in Admin → Facilities.
              </span>
            )}
          </span>
        )}
        {note && <span className="ml-auto text-xs font-medium text-secured">{note}</span>}
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] gap-0 md:grid-cols-2 md:grid-rows-1">
        {/* composer */}
        {canSend && (
          <div className="border-b border-surface-border p-6 md:border-b-0 md:border-r">
            <h3 className="font-display font-bold">Email this facility</h3>
            <p className="mt-1 text-xs text-surface-muted">
              Sends a real email (with a HIPAA confidentiality notice). Their reply
              comes back to you.
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
          {loading && (
            <p className="mt-4 text-sm text-surface-muted">Loading…</p>
          )}
          {!loading && messages.length === 0 && (
            <p className="mt-4 text-sm text-surface-muted">
              No messages yet. Send the first one from the left.
            </p>
          )}
          <div className="mt-4 space-y-3">
            {messages.map((m) => (
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
                    {m.direction === "inbound" ? "↩ Facility reply" : "→ Sent to facility"}
                    {m.claim_id ? ` · claim ${m.claim_id}` : ""}
                    {m.patient_name ? ` · ${m.patient_name}` : ""}
                  </span>
                  <span>{new Date(m.created_at).toLocaleString()}</span>
                </div>
                {m.subject && <div className="font-semibold">{m.subject}</div>}
                <div className="whitespace-pre-wrap">{m.body}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
