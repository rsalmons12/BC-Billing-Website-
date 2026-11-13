"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import { SumCard } from "@/components/trackers/TrackerModule";
import { money } from "@/lib/format";
import { isExcludedMember, isStaleClaim } from "@/lib/claims";
import { payerBucket } from "@/lib/payer";
import {
  RISK_AGE_THRESHOLD,
  type Claim,
  type Facility,
  type Payment,
} from "@/lib/types";
import {
  buildRateBook,
  projectClaim,
  MIN_MEMBER_CHARGE,
  type RateBook,
  type PayLike,
} from "@/lib/projection";

export default function ProjectionsClient({
  facilities,
}: {
  facilities: Facility[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [facilityId, setFacilityId] = useState<string>(
    facilities.length > 1 ? "all" : facilities[0]?.id ?? ""
  );
  const [claims, setClaims] = useState<Claim[]>([]);
  const [book, setBook] = useState<RateBook | null>(null);
  const [payCount, setPayCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const allFacilities = facilityId === "all";
  const facName = useCallback(
    (id: string | null) => {
      const f = facilities.find((x) => x.id === id);
      return f?.short_name || f?.name || "—";
    },
    [facilities]
  );

  // Load present claims + payment history for the facility scope, then build the
  // collection-rate book from the payments.
  const load = useCallback(async () => {
    if (!facilityId) {
      setClaims([]);
      setBook(null);
      return;
    }
    setLoading(true);
    const [claimList, pays] = await Promise.all([
      selectAll<Claim>((f, t) => {
        let q = supabase.from("claims").select("*").eq("present", true);
        if (facilityId !== "all") q = q.eq("facility_id", facilityId);
        return q.order("balance", { ascending: false }).range(f, t);
      }),
      selectAll<PayLike>((f, t) => {
        let q = supabase
          .from("payments")
          .select("member_id,payment_source,charge_amount,paid_amount,facility_id");
        if (facilityId !== "all") q = q.eq("facility_id", facilityId);
        return q.range(f, t);
      }).catch(() => [] as PayLike[]),
    ]);
    const visible = claimList.filter(
      (c) => !isExcludedMember(c.member_id) && !isStaleClaim(c.age_days)
    );
    setClaims(visible);
    setBook(buildRateBook(pays as Payment[]));
    setPayCount(pays.length);
    setLoading(false);
  }, [supabase, facilityId]);

  useEffect(() => {
    load();
  }, [load]);

  // Project every claim, keep the ones with a projection, sort by expected $.
  const projected = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = claims
      .filter((c) => {
        if (!q) return true;
        const hay = `${c.patient_name ?? ""} ${c.member_id ?? ""} ${c.claim_id} ${
          c.claim_status ?? ""
        }`.toLowerCase();
        return hay.includes(q);
      })
      .map((c) => ({ c, p: projectClaim(c, book) }));
    rows.sort((a, b) => b.p.expected - a.p.expected);
    return rows;
  }, [claims, book, search]);

  const summary = useMemo(() => {
    let openBalance = 0;
    let expected = 0;
    let projectedBalance = 0;
    let projectedCount = 0;
    let blankCount = 0;
    const byPayer = new Map<string, { balance: number; expected: number }>();
    for (const { c, p } of projected) {
      const bal = Number(c.balance) || 0;
      openBalance += bal;
      if (p.source === "none") {
        blankCount++;
        continue;
      }
      expected += p.expected;
      projectedBalance += bal;
      projectedCount++;
      const pk = payerBucket(c.claim_status);
      const e = byPayer.get(pk) ?? { balance: 0, expected: 0 };
      e.balance += bal;
      e.expected += p.expected;
      byPayer.set(pk, e);
    }
    const blendedRate = projectedBalance > 0 ? expected / projectedBalance : 0;
    const payerRows = Array.from(byPayer.entries())
      .map(([payer, v]) => ({ payer, ...v, rate: v.balance > 0 ? v.expected / v.balance : 0 }))
      .sort((a, b) => b.expected - a.expected);
    return { openBalance, expected, projectedCount, blankCount, blendedRate, payerRows };
  }, [projected]);

  const exportXlsx = async () => {
    const XLSX = await import("xlsx");
    const data = projected.map(({ c, p }) => ({
      Patient: c.patient_name ?? "",
      Facility: facName(c.facility_id),
      "Member ID": c.member_id ?? "",
      "Claim ID": c.claim_id,
      "Age (Days)": c.age_days ?? 0,
      "DOS From": c.dos_from ?? "",
      "DOS To": c.dos_to ?? "",
      Charge: c.charge_amount ?? 0,
      Balance: c.balance ?? 0,
      "Expected $": p.source !== "none" ? Math.round(p.expected) : "",
      "Est. Rate": p.rate != null ? `${Math.round(p.rate * 100)}%` : "",
      Basis: p.source === "member" ? "Member" : p.source === "payer" ? "Payer" : "",
      Status: c.claim_status ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Projected Revenue");
    const label = allFacilities ? "all-facilities" : facName(facilityId);
    XLSX.writeFile(wb, `projected-revenue-${label}.xlsx`);
  };

  const RENDER_CAP = 500;
  const visible = projected.slice(0, RENDER_CAP);
  const hidden = projected.length - visible.length;

  return (
    <div className="flex h-full flex-col">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-surface-border bg-surface-card px-6 py-3">
        <select
          value={facilityId}
          onChange={(e) => setFacilityId(e.target.value)}
          className="input max-w-[16rem]"
        >
          {facilities.length === 0 && <option value="">No facilities</option>}
          {facilities.length > 1 && <option value="all">All facilities</option>}
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>
              {f.short_name || f.name}
            </option>
          ))}
        </select>

        <input
          placeholder="Search patient, member, claim…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input max-w-[18rem] flex-1"
        />

        <div className="ml-auto flex items-center gap-3 text-xs">
          {loading && <span className="font-medium text-secured">Loading…</span>}
          <span className="text-surface-muted">
            <b className="text-surface-ink">{payCount.toLocaleString()}</b> payments in history
          </span>
          <button onClick={exportXlsx} className="btn-ghost" disabled={projected.length === 0}>
            ↓ Export
          </button>
        </div>
      </div>

      {/* summary cards */}
      <div className="border-b border-surface-border bg-surface px-6 py-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <SumCard label="Open balance" value={money(summary.openBalance)} accent="gold" />
          <SumCard
            label="Projected revenue"
            value={loading ? "…" : money(summary.expected)}
            accent="recovered"
          />
          <SumCard
            label="Expected rate"
            value={loading ? "…" : `${Math.round(summary.blendedRate * 100)}%`}
          />
          <SumCard
            label="Projected / blank"
            value={`${summary.projectedCount} / ${summary.blankCount}`}
          />
        </div>
        <p className="mt-1 text-[11px] text-surface-muted">
          Expected revenue = each open balance × its historical collection rate — that
          member&apos;s paid÷charged first (needs ≥ {money(MIN_MEMBER_CHARGE)} of history), then
          the payer family. {summary.blankCount} claim{summary.blankCount === 1 ? "" : "s"} with no
          member or payer history {summary.blankCount === 1 ? "is" : "are"} left out. Upload more
          payment history (Payments → Import) to tighten the estimate.
        </p>
        {summary.payerRows.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {summary.payerRows.map((p) => (
              <span key={p.payer} className="badge bg-recovered/10 text-recovered">
                {p.payer}: <b className="ml-1">{money(p.expected)}</b>
                <span className="mx-1 opacity-50">·</span>
                {Math.round(p.rate * 100)}%
              </span>
            ))}
          </div>
        )}
      </div>

      {/* table */}
      <div className="scroll-x min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              <th className="th sticky left-0 bg-surface">Patient</th>
              {allFacilities && <th className="th">Facility</th>}
              <th className="th">Member ID</th>
              <th className="th">Claim #</th>
              <th className="th text-right">Age</th>
              <th className="th">DOS</th>
              <th className="th text-right">Charge</th>
              <th className="th text-right">Balance</th>
              <th className="th text-right">Expected $</th>
              <th className="th text-right">Rate</th>
              <th className="th">Basis</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={allFacilities ? 12 : 11} className="td py-10 text-center text-surface-muted">
                  Loading claims and payment history…
                </td>
              </tr>
            )}
            {!loading && projected.length === 0 && (
              <tr>
                <td colSpan={allFacilities ? 12 : 11} className="td py-10 text-center text-surface-muted">
                  No open claims here. (Projections need present claims and uploaded payments.)
                </td>
              </tr>
            )}
            {!loading &&
              visible.map(({ c, p }, i) => (
                <tr
                  key={c.id}
                  className={`${i % 2 ? "bg-surface/40" : "bg-surface-card"} hover:bg-recovered/5`}
                >
                  <td className="td sticky left-0 bg-inherit font-medium">
                    {c.patient_name || "—"}
                  </td>
                  {allFacilities && (
                    <td className="td text-xs text-surface-muted">{facName(c.facility_id)}</td>
                  )}
                  <td className="td font-mono text-xs text-surface-muted">{c.member_id || "—"}</td>
                  <td className="td font-mono text-xs">{c.claim_id}</td>
                  <td className="td text-right font-mono text-xs">
                    <span className={(c.age_days ?? 0) > RISK_AGE_THRESHOLD ? "text-risk" : ""}>
                      {c.age_days ?? 0}d
                    </span>
                  </td>
                  <td className="td text-xs text-surface-muted">
                    {c.dos_from || "—"}
                    {c.dos_to ? `–${c.dos_to}` : ""}
                  </td>
                  <td className="td text-right font-mono">{money(c.charge_amount)}</td>
                  <td className="td text-right font-mono font-semibold">{money(c.balance)}</td>
                  <td className="td text-right font-mono text-recovered">
                    {p.source === "none" ? <span className="text-surface-muted">—</span> : money(p.expected)}
                  </td>
                  <td className="td text-right font-mono text-xs text-surface-muted">
                    {p.rate != null ? `${Math.round(p.rate * 100)}%` : "—"}
                  </td>
                  <td className="td text-xs">
                    {p.source === "member" ? (
                      <span className="badge bg-recovered/12 text-recovered" title="Based on this member's own payment history">
                        Member
                      </span>
                    ) : p.source === "payer" ? (
                      <span className="badge bg-command/10 text-command" title="Based on the payer family's average collection rate">
                        Payer
                      </span>
                    ) : (
                      <span className="text-surface-muted">no history</span>
                    )}
                  </td>
                  <td className="td text-xs text-surface-muted">{c.claim_status || "—"}</td>
                </tr>
              ))}
            {!loading && hidden > 0 && (
              <tr>
                <td colSpan={allFacilities ? 12 : 11} className="td py-3 text-center text-xs text-surface-muted">
                  Showing the top {RENDER_CAP} by expected $ — {hidden} more. Narrow with search or
                  pick a single facility.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
