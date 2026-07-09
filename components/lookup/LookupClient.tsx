"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/format";
import type { Claim, ClaimWork, FacilityMessage, Facility } from "@/lib/types";

type AssignRow = Pick<
  Claim,
  "claim_id" | "patient_name" | "facility_id" | "balance" | "claim_status" | "present"
> & { work: ClaimWork | null };

export default function LookupClient({ facilities }: { facilities: Facility[] }) {
  const supabase = useMemo(() => createClient(), []);
  const facName = useCallback(
    (id: string | null) => {
      const f = facilities.find((x) => x.id === id);
      return f?.short_name || f?.name || "—";
    },
    [facilities]
  );

  // id -> display name, so we can resolve collectors and senders.
  const [nameMap, setNameMap] = useState<Record<string, string>>({});
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, initials");
      const m: Record<string, string> = {};
      for (const p of (data as { id: string; full_name: string | null; initials: string | null }[]) ??
        []) {
        m[p.id] = (p.full_name?.trim() || p.initials?.trim() || "").trim();
      }
      setNameMap(m);
    })();
  }, [supabase]);

  const who = useCallback(
    (id: string | null | undefined) => (id ? nameMap[id] || "Unknown user" : ""),
    [nameMap]
  );

  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [assignments, setAssignments] = useState<AssignRow[]>([]);
  const [messages, setMessages] = useState<FacilityMessage[]>([]);

  const search = useCallback(async () => {
    const term = q.trim();
    if (!term) return;
    setLoading(true);
    setSearched(true);
    const like = `%${term}%`;

    // Claims for this patient + their work layer (collector, worked status).
    const { data: claims } = await supabase
      .from("claims")
      .select("claim_id, patient_name, facility_id, balance, claim_status, present")
      .ilike("patient_name", like)
      .limit(300);
    const ids = (claims ?? []).map((c) => c.claim_id);
    const workMap: Record<string, ClaimWork> = {};
    for (let i = 0; i < ids.length; i += 1000) {
      const slice = ids.slice(i, i + 1000);
      const { data: work } = await supabase.from("claim_work").select("*").in("claim_id", slice);
      for (const w of (work as ClaimWork[]) ?? []) workMap[w.claim_id] = w;
    }
    setAssignments(
      ((claims as AssignRow[]) ?? []).map((c) => ({ ...c, work: workMap[c.claim_id] ?? null }))
    );

    // Every message where this patient's name was recorded.
    const { data: msgs } = await supabase
      .from("facility_messages")
      .select("*")
      .ilike("patient_name", like)
      .order("created_at", { ascending: false })
      .limit(200);
    setMessages((msgs as FacilityMessage[]) ?? []);

    setLoading(false);
  }, [supabase, q]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") search();
  };

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="card p-5">
          <h2 className="font-display text-lg font-bold">Patient lookup</h2>
          <p className="mt-1 text-sm text-surface-muted">
            Type a patient name to see which collector holds them and who has emailed their
            facility about them. Names are usually stored “Last, First”.
          </p>
          <div className="mt-4 flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKey}
              className="input flex-1"
              placeholder="e.g. Bryant, Neal"
              autoFocus
            />
            <button onClick={search} disabled={loading || !q.trim()} className="btn-primary">
              {loading ? "Searching…" : "Search"}
            </button>
          </div>
        </div>

        {searched && (
          <>
            {/* ---- Assigned collector(s) ---- */}
            <section className="card overflow-hidden">
              <div className="border-b border-surface-border px-5 py-3 font-semibold">
                Assigned collector{" "}
                <span className="text-sm font-normal text-surface-muted">
                  ({assignments.length} claim{assignments.length === 1 ? "" : "s"})
                </span>
              </div>
              {!loading && assignments.length === 0 ? (
                <p className="px-5 py-6 text-sm text-surface-muted">
                  No claims found for that name.
                </p>
              ) : (
                <div className="scroll-x overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface">
                      <tr>
                        <th className="th">Patient</th>
                        <th className="th">Claim</th>
                        <th className="th">Facility</th>
                        <th className="th text-right">Balance</th>
                        <th className="th">Status</th>
                        <th className="th">Collector</th>
                        <th className="th">Held on</th>
                        <th className="th">Worked</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assignments.map((a, i) => (
                        <tr key={a.claim_id} className={i % 2 ? "bg-surface/40" : ""}>
                          <td className="td font-medium">{a.patient_name || "—"}</td>
                          <td className="td font-mono text-xs">{a.claim_id}</td>
                          <td className="td text-xs text-surface-muted">{facName(a.facility_id)}</td>
                          <td className="td text-right font-mono">{money(a.balance)}</td>
                          <td className="td text-xs">{a.claim_status || "—"}</td>
                          <td className="td font-medium">
                            {a.work?.claimed_by ? (
                              who(a.work.claimed_by)
                            ) : (
                              <span className="text-surface-muted">Unassigned</span>
                            )}
                          </td>
                          <td className="td text-xs text-surface-muted">
                            {a.work?.claimed_at || "—"}
                          </td>
                          <td className="td text-xs">
                            {a.work?.date_worked ? (
                              <span className="text-recovered">
                                {a.work.date_worked}
                                {a.work.initials ? ` (${a.work.initials})` : ""}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* ---- Messages about this patient ---- */}
            <section className="card overflow-hidden">
              <div className="border-b border-surface-border px-5 py-3 font-semibold">
                Messages{" "}
                <span className="text-sm font-normal text-surface-muted">
                  ({messages.length})
                </span>
              </div>
              {!loading && messages.length === 0 ? (
                <p className="px-5 py-6 text-sm text-surface-muted">
                  No messages recorded with this patient&apos;s name.
                </p>
              ) : (
                <div className="scroll-x overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface">
                      <tr>
                        <th className="th">When</th>
                        <th className="th">Direction</th>
                        <th className="th">Facility</th>
                        <th className="th">Sent by</th>
                        <th className="th">Subject</th>
                      </tr>
                    </thead>
                    <tbody>
                      {messages.map((m, i) => (
                        <tr key={m.id} className={i % 2 ? "bg-surface/40" : ""}>
                          <td className="td whitespace-nowrap text-xs text-surface-muted">
                            {new Date(m.created_at).toLocaleString()}
                          </td>
                          <td className="td text-xs">
                            {m.direction === "inbound" ? "↩ Facility reply" : "→ Sent to facility"}
                          </td>
                          <td className="td text-xs text-surface-muted">{facName(m.facility_id)}</td>
                          <td className="td font-medium">
                            {m.direction === "inbound"
                              ? "—"
                              : m.sender_name?.trim() || who(m.sender_id) || "—"}
                          </td>
                          <td className="td text-xs">{m.subject || "(no subject)"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
