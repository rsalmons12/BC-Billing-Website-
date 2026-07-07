"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import { periodOf } from "@/lib/import/parseTrackers";
import { buildMonthlyBundle } from "@/lib/report/monthlyBundle";
import { money } from "@/lib/format";
import type { Payment, BilledClaim, Facility } from "@/lib/types";
import type { RepricingRow } from "@/lib/import/parseTrackers";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(ym: string): string {
  const m = ym.match(/^(\d{4})-(\d{2})$/);
  if (!m) return ym;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

export default function MonthlyReportClient({ facilities }: { facilities: Facility[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [facilityId, setFacilityId] = useState(facilities[0]?.id ?? "");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [billed, setBilled] = useState<BilledClaim[]>([]);
  const [repricing, setRepricing] = useState<(RepricingRow & { facility_id?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState("");

  const load = useCallback(async () => {
    if (!facilityId) return;
    setLoading(true);
    const [pay, bil, rep] = await Promise.all([
      selectAll<Payment>((f, t) =>
        supabase.from("payments").select("*").eq("facility_id", facilityId).range(f, t)
      ),
      selectAll<BilledClaim>((f, t) =>
        supabase.from("billed_claims").select("*").eq("facility_id", facilityId).range(f, t)
      ),
      selectAll<RepricingRow & { facility_id?: string }>((f, t) =>
        supabase.from("repricing").select("*").eq("facility_id", facilityId).range(f, t)
      ).catch(() => []),
    ]);
    setPayments(pay);
    setBilled(bil);
    setRepricing(rep);
    setLoading(false);
  }, [supabase, facilityId]);

  useEffect(() => {
    load();
  }, [load]);

  // A payment counts toward the month of its deposit (fallback: entered) date.
  const payMonth = (p: Payment) => periodOf(p.deposit_date ?? "", p.payment_entered ?? "", p.period ?? "");
  const bilMonth = (b: BilledClaim) => b.period || periodOf(b.entered_date ?? "");

  // Months that have data (newest first).
  const months = useMemo(() => {
    const s = new Set<string>();
    for (const p of payments) { const m = payMonth(p); if (m) s.add(m); }
    for (const b of billed) { const m = bilMonth(b); if (m) s.add(m); }
    return Array.from(s).sort().reverse();
  }, [payments, billed]);

  useEffect(() => {
    if (months.length && !months.includes(month)) setMonth(months[0]);
  }, [months, month]);

  const facilityName =
    facilities.find((f) => f.id === facilityId)?.name ||
    facilities.find((f) => f.id === facilityId)?.short_name ||
    "Facility";

  const monthPayments = payments.filter((p) => payMonth(p) === month);
  const monthBilled = billed.filter((b) => bilMonth(b) === month);

  const download = () => {
    const wb = buildMonthlyBundle({
      facilityName,
      monthLabel: monthLabel(month),
      payments: monthPayments,
      billed: monthBilled,
      repricing: repricing,
    });
    const safe = `${facilityName}_${month}`.replace(/[^\w-]+/g, "_");
    XLSX.writeFile(wb, `${safe}_Monthly_Report.xlsx`);
  };

  const totalCollected = monthPayments.reduce((s, p) => s + (p.paid_amount ?? 0), 0);
  const totalBilled = monthBilled.reduce((s, b) => s + (b.total_amount ?? 0), 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="card p-5">
        <h2 className="font-display text-lg font-bold">Monthly report bundle</h2>
        <p className="mt-1 text-sm text-surface-muted">
          Download a packaged Excel for a facility and month — SUMMARY, Check Numbers,
          Patient Deposits, and Billed Report — built from your payments and billed data.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Facility</span>
            <select
              value={facilityId}
              onChange={(e) => setFacilityId(e.target.value)}
              className="input w-full"
            >
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.short_name || f.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Month</span>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="input w-full"
              disabled={loading || months.length === 0}
            >
              {months.length === 0 && <option value="">No data</option>}
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!loading && month && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-surface-border p-3">
              <div className="label">Collected · {monthLabel(month)}</div>
              <div className="font-display text-xl font-bold text-recovered">
                {money(totalCollected)}
              </div>
              <div className="text-xs text-surface-muted">{monthPayments.length} payment lines</div>
            </div>
            <div className="rounded-lg border border-surface-border p-3">
              <div className="label">Billed · {monthLabel(month)}</div>
              <div className="font-display text-xl font-bold text-gold">{money(totalBilled)}</div>
              <div className="text-xs text-surface-muted">{monthBilled.length} claims</div>
            </div>
          </div>
        )}

        <button
          onClick={download}
          disabled={loading || !month || (monthPayments.length === 0 && monthBilled.length === 0)}
          className="btn-primary mt-4 disabled:opacity-50"
        >
          ↓ Download {month ? monthLabel(month) : ""} bundle
        </button>
        {loading && <span className="ml-3 text-xs text-surface-muted">Loading data…</span>}
      </div>

      <p className="text-xs text-surface-muted">
        Tip: import each month&apos;s Payment and Billed reports first (Payments / Billed tabs),
        then come here to package them. Re-import a month anytime — the bundle always reflects the
        latest.
      </p>
    </div>
  );
}
