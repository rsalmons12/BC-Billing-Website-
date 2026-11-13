"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import { SumCard } from "@/components/trackers/TrackerModule";
import { money } from "@/lib/format";
import { isExcludedMember, isStaleClaim } from "@/lib/claims";
import { payerBucket } from "@/lib/payer";
import { RISK_AGE_THRESHOLD, type Claim, type Facility } from "@/lib/types";
import { projectClaim, type ProjectionRates } from "@/lib/projection";

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
  const [rates, setRates] = useState<ProjectionRates | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");

  const allFacilities = facilityId === "all";
  const facName = useCallback(
    (id: string | null) => {
      const f = facilities.find((x) => x.id === id);
      return f?.short_name || f?.name || "—";
    },
    [facilities]
  );

  // Load present claims (for the table) + the server-built rate table (payments
  // and billed history are too large to pull into the browser).
  const load = useCallback(async () => {
    if (!facilityId) {
      setClaims([]);
      setRates(null);
      return;
    }
    setLoading(true);
    setErr("");
    try {
      const [claimList, rateRes] = await Promise.all([
        selectAll<Claim>((f, t) => {
          let q = supabase.from("claims").select("*").eq("present", true);
          if (facilityId !== "all") q = q.eq("facility_id", facilityId);
          return q.order("balance", { ascending: false }).range(f, t);
        }),
        fetch(`/api/projection-rates?facility=${encodeURIComponent(facilityId)}`).then((r) =>
          r.ok ? (r.json() as Promise<ProjectionRates>) : Promise.reject(new Error(`rates ${r.status}`))
        ),
      ]);
      const visible = claimList.filter(
        (c) => !isExcludedMember(c.member_id) && !isStaleClaim(c.age_days)
      );
      setClaims(visible);
      setRates(rateRes);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load projections");
      setRates(null);
    } finally {
      setLoading(false);
    }
  }, [supabase, facilityId]);

  useEffect(() => {
    load();
  }, [load]);

  // Project every claim, sort by expected $.
  const projected = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = claims
      .filter((c) => {
        if (!q) return true;
        const hay = `${c.patient_name ?? ""} ${c.member_id ?? ""} ${c.claim_id} ${
          c.claim_status ?? ""
        }`.toLowerCase();
        return hay.includes(q);
      })
      .map((c) => ({ c, p: projectClaim(c, rates) }));
    out.sort((a, b) => b.p.expected - a.p.expected);
    return out;
  }, [claims, rates, search]);

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
    const scopeLabel = allFacilities ? "All facilities" : facName(facilityId);
    // Summary sheet: headline KPIs + per-payer breakdown.
    const summaryAoa: (string | number)[][] = [
      ["Projected Revenue", scopeLabel],
      ["Generated", new Date().toLocaleString()],
      [],
      ["Open balance", Math.round(summary.openBalance)],
      ["Projected revenue", Math.round(summary.expected)],
      ["Expected rate", `${Math.round(summary.blendedRate * 100)}%`],
      ["Projected claims", summary.projectedCount],
      ["No-history claims (blank)", summary.blankCount],
      [],
      ["Payer", "Open balance", "Expected $", "Rate"],
      ...summary.payerRows.map((p) => [
        p.payer,
        Math.round(p.balance),
        Math.round(p.expected),
        `${Math.round(p.rate * 100)}%`,
      ]),
    ];
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
      Basis: p.source === "patient" ? "Patient" : p.source === "payer" ? "Payer" : "",
      Status: c.claim_status ?? "",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryAoa), "Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Claims");
    const label = allFacilities ? "all-facilities" : facName(facilityId);
    XLSX.writeFile(wb, `projected-revenue-${label}.xlsx`);
  };

  const RENDER_CAP = 500;
  const visible = projected.slice(0, RENDER_CAP);
  const hidden = projected.length - visible.length;
  const colCount = allFacilities ? 12 : 11;

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
          {err && <span className="font-medium text-risk">{err}</span>}
          {rates && (
            <span className="text-surface-muted">
              <b className="text-surface-ink">{rates.meta.payments.toLocaleString()}</b> payments ·{" "}
              <b className="text-surface-ink">{rates.meta.billed.toLocaleString()}</b> billed
            </span>
          )}
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
          Expected revenue = each open balance × its historical collection rate (paid ÷ resolved
          billed, matched by patient name) — that patient&apos;s own rate first, then the payer
          family. &quot;Resolved&quot; excludes still-open claims from the denominator so the rate
          reflects closed business, not work in flight. {rates ? `${rates.meta.paidMatchedPct}% of payment dollars matched a current patient.` : ""}
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
                <td colSpan={colCount} className="td py-10 text-center text-surface-muted">
                  Loading claims and building collection rates…
                </td>
              </tr>
            )}
            {!loading && projected.length === 0 && (
              <tr>
                <td colSpan={colCount} className="td py-10 text-center text-surface-muted">
                  No open claims here.
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
                    {p.source === "patient" ? (
                      <span className="badge bg-recovered/12 text-recovered" title="This patient's own paid÷billed history">
                        Patient
                      </span>
                    ) : p.source === "payer" ? (
                      <span className="badge bg-command/10 text-command" title="The payer family's average collection rate">
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
                <td colSpan={colCount} className="td py-3 text-center text-xs text-surface-muted">
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
