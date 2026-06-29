"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import { money } from "@/lib/format";
import type { Claim, ClaimWork, AuthIssue, Facility } from "@/lib/types";

type Escalation = {
  claim_id: string;
  patient_name: string | null;
  facility_id: string;
  balance: number | null;
  age_days: number | null;
  claim_status: string | null;
  notes: string;
};

export default function ManagementClient({ facilities }: { facilities: Facility[] }) {
  const supabase = useMemo(() => createClient(), []);
  const facName = useCallback(
    (id: string | null) => {
      const f = facilities.find((x) => x.id === id);
      return f?.short_name || f?.name || "—";
    },
    [facilities]
  );

  const [collections, setCollections] = useState<Escalation[]>([]);
  const [authEsc, setAuthEsc] = useState<AuthIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    // Collections escalations: claim_work flagged mgmt_needed, joined to claims.
    const work = await selectAll<ClaimWork>((f, t) =>
      supabase.from("claim_work").select("*").eq("mgmt_needed", true).range(f, t)
    );
    const ids = work.map((w) => w.claim_id);
    const claimMap: Record<string, Claim> = {};
    for (let i = 0; i < ids.length; i += 1000) {
      const slice = ids.slice(i, i + 1000);
      const { data } = await supabase.from("claims").select("*").in("claim_id", slice);
      for (const c of (data as Claim[]) ?? []) claimMap[c.claim_id] = c;
    }
    setCollections(
      work
        .map((w) => {
          const c = claimMap[w.claim_id];
          if (!c) return null;
          return {
            claim_id: w.claim_id,
            patient_name: c.patient_name,
            facility_id: c.facility_id,
            balance: c.balance,
            age_days: c.age_days,
            claim_status: c.claim_status,
            notes: w.notes || "",
          } as Escalation;
        })
        .filter(Boolean) as Escalation[]
    );

    const issues = await selectAll<AuthIssue>((f, t) =>
      supabase.from("auth_issues").select("*").eq("mgmt_needed", true).range(f, t)
    );
    setAuthEsc(issues);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const resolveClaim = async (claimId: string) => {
    setCollections((prev) => prev.filter((e) => e.claim_id !== claimId));
    setMsg("Resolved");
    await supabase.from("claim_work").update({ mgmt_needed: false }).eq("claim_id", claimId);
    setTimeout(() => setMsg(""), 1000);
  };
  const resolveAuth = async (id: string) => {
    setAuthEsc((prev) => prev.filter((e) => e.id !== id));
    setMsg("Resolved");
    await supabase.from("auth_issues").update({ mgmt_needed: false }).eq("id", id);
    setTimeout(() => setMsg(""), 1000);
  };

  const totalBalance = collections.reduce((s, e) => s + (e.balance ?? 0), 0);

  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="text-surface-muted">
            <b className="text-surface-ink">{collections.length + authEsc.length}</b>{" "}
            items need management
          </span>
          <span className="text-surface-muted">
            Balance flagged{" "}
            <b className="font-mono text-surface-ink">{money(totalBalance)}</b>
          </span>
          {msg && <span className="font-medium text-secured">{msg}</span>}
        </div>

        {/* From Collections */}
        <section className="card overflow-hidden">
          <div className="border-b border-surface-border px-5 py-3 font-semibold">
            From Collections{" "}
            <span className="text-sm font-normal text-surface-muted">
              ({collections.length})
            </span>
          </div>
          {loading ? (
            <p className="px-5 py-6 text-sm text-surface-muted">Loading…</p>
          ) : collections.length === 0 ? (
            <p className="px-5 py-6 text-sm text-surface-muted">
              Nothing flagged. Collectors check “Mgmt” on a claim to send it here.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-surface">
                <tr>
                  <th className="th">Patient</th>
                  <th className="th">Facility</th>
                  <th className="th">Age</th>
                  <th className="th text-right">Balance</th>
                  <th className="th">Status</th>
                  <th className="th min-w-[20rem]">Notes</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody>
                {collections.map((e, i) => (
                  <tr key={e.claim_id} className={i % 2 ? "bg-surface/40" : ""}>
                    <td className="td font-medium">{e.patient_name || "—"}</td>
                    <td className="td text-xs text-surface-muted">{facName(e.facility_id)}</td>
                    <td className="td font-mono text-xs">{e.age_days ?? 0}d</td>
                    <td className="td text-right font-mono">{money(e.balance)}</td>
                    <td className="td text-xs">{e.claim_status || "—"}</td>
                    <td className="td whitespace-pre-wrap break-words text-xs">
                      {e.notes || "—"}
                    </td>
                    <td className="td">
                      <button
                        onClick={() => resolveClaim(e.claim_id)}
                        className="rounded-md border border-surface-border px-2 py-1 text-xs font-semibold text-recovered hover:bg-recovered/10"
                      >
                        Resolve
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* From Auth Issues */}
        <section className="card overflow-hidden">
          <div className="border-b border-surface-border px-5 py-3 font-semibold">
            From Auth Issues{" "}
            <span className="text-sm font-normal text-surface-muted">({authEsc.length})</span>
          </div>
          {!loading && authEsc.length === 0 ? (
            <p className="px-5 py-6 text-sm text-surface-muted">Nothing flagged.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-surface">
                <tr>
                  <th className="th">Patient</th>
                  <th className="th">Facility</th>
                  <th className="th text-right">Amount</th>
                  <th className="th">Status</th>
                  <th className="th min-w-[20rem]">Notes</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody>
                {authEsc.map((e, i) => (
                  <tr key={e.id} className={i % 2 ? "bg-surface/40" : ""}>
                    <td className="td font-medium">{e.patient_name || "—"}</td>
                    <td className="td text-xs text-surface-muted">{facName(e.facility_id)}</td>
                    <td className="td text-right font-mono">{money(e.charge_amount)}</td>
                    <td className="td text-xs">{e.status}</td>
                    <td className="td whitespace-pre-wrap break-words text-xs">
                      {e.notes || "—"}
                    </td>
                    <td className="td">
                      <button
                        onClick={() => resolveAuth(e.id)}
                        className="rounded-md border border-surface-border px-2 py-1 text-xs font-semibold text-recovered hover:bg-recovered/10"
                      >
                        Resolve
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
