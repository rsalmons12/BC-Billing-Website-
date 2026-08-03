"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import { periodOf } from "@/lib/import/parseTrackers";
import { buildMonthlyBundle } from "@/lib/report/monthlyBundle";
import { money } from "@/lib/format";
import type { Payment, BilledClaim, Claim, Negotiation, Facility } from "@/lib/types";

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
  const [claims, setClaims] = useState<Claim[]>([]);
  const [negotiations, setNegotiations] = useState<Negotiation[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState("");

  const load = useCallback(async () => {
    if (!facilityId) return;
    setLoading(true);
    const safe = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);
    const [pay, bil, clm, neg] = await Promise.all([
      safe(
        selectAll<Payment>((f, t) =>
          supabase.from("payments").select("*").eq("facility_id", facilityId).range(f, t)
        )
      ),
      safe(
        selectAll<BilledClaim>((f, t) =>
          supabase.from("billed_claims").select("*").eq("facility_id", facilityId).range(f, t)
        )
      ),
      safe(
        selectAll<Claim>((f, t) =>
          supabase
            .from("claims")
            .select("*")
            .eq("facility_id", facilityId)
            .eq("present", true)
            .range(f, t)
        )
      ),
      safe(
        selectAll<Negotiation>((f, t) =>
          supabase.from("negotiations").select("*").eq("facility_id", facilityId).range(f, t)
        )
      ),
    ]);
    setPayments(pay);
    setBilled(bil);
    setClaims(clm);
    setNegotiations(neg);
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

  const facility = facilities.find((f) => f.id === facilityId);
  const facilityName = facility?.name || facility?.short_name || "Facility";
  const billingRate = facility?.billing_rate ?? null;

  const monthPayments = payments.filter((p) => payMonth(p) === month);
  const monthBilled = billed.filter((b) => bilMonth(b) === month);

  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    setDownloading(true);
    try {
      const buf = await buildMonthlyBundle({
        facilityName,
        monthLabel: monthLabel(month),
        payments: monthPayments,
        billed: monthBilled,
        claims, // live AR snapshot
        negotiations,
        billingRate, // invoice sheet = collected × rate
        invoiceDate: new Date().toLocaleDateString("en-US"),
      });
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${`${facilityName}_${month}`.replace(/[^\w-]+/g, "_")}_Monthly_Report.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  const totalCollected = monthPayments.reduce((s, p) => s + (p.paid_amount ?? 0), 0);
  const totalBilled = monthBilled.reduce((s, b) => s + (b.total_amount ?? 0), 0);

  const [invoiceMsg, setInvoiceMsg] = useState("");
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const emailInvoice = async (test: boolean) => {
    // Real send: show EXACTLY who will receive it (never a facility) and confirm.
    if (!test) {
      setInvoiceBusy(true);
      setInvoiceMsg("Checking recipients…");
      try {
        const res = await fetch("/api/invoice-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ facilityId, month, dryRun: true }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) {
          setInvoiceMsg(`Error: ${d.error || "could not check recipients"}`);
          setInvoiceBusy(false);
          return;
        }
        const rec = (d.recipients ?? []) as string[];
        if (rec.length === 0) {
          setInvoiceMsg('No one is set to receive invoices. Check "Invoices" for a user in Admin → Users.');
          setInvoiceBusy(false);
          setTimeout(() => setInvoiceMsg(""), 10000);
          return;
        }
        if (
          !confirm(
            `Email ${facilityName}'s ${monthLabel(month)} invoice to:\n\n${rec
              .map((e) => `• ${e}`)
              .join("\n")}\n\n(Facilities are never included.)\n\nSend now?`
          )
        ) {
          setInvoiceMsg("Cancelled — nothing was sent.");
          setInvoiceBusy(false);
          setTimeout(() => setInvoiceMsg(""), 5000);
          return;
        }
      } catch {
        setInvoiceMsg("Error: could not check recipients");
        setInvoiceBusy(false);
        return;
      }
    }
    setInvoiceBusy(true);
    setInvoiceMsg("Sending…");
    try {
      const res = await fetch("/api/invoice-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facilityId, month, test }),
      });
      const data = await res.json().catch(() => ({}));
      const who = Array.isArray(data.sentTo) && data.sentTo.length ? ` → ${data.sentTo.join(", ")}` : "";
      setInvoiceMsg(
        res.ok
          ? test
            ? `✓ Test invoice sent to you${who}.`
            : `✓ Invoice emailed to ${data.recipients ?? 0} recipient(s)${who}.`
          : `Error: ${data.error || "could not send"}`
      );
    } catch {
      setInvoiceMsg("Error: could not send");
    } finally {
      setInvoiceBusy(false);
      setTimeout(() => setInvoiceMsg(""), 15000);
    }
  };

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

        {!loading && month && (
          <div className="mt-3 rounded-lg border border-secured/40 bg-secured/5 p-3">
            <div className="label">Invoice · {monthLabel(month)}</div>
            {billingRate != null && billingRate > 0 ? (
              <>
                <div className="font-display text-2xl font-bold text-secured">
                  {money(totalCollected * (billingRate / 100))}
                </div>
                <div className="text-xs text-surface-muted">
                  {billingRate}% of {money(totalCollected)} collected · included as an INVOICE sheet in the bundle
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => emailInvoice(false)}
                    disabled={invoiceBusy}
                    className="badge bg-secured/12 px-3 py-1.5 text-xs font-semibold text-secured hover:bg-secured/20 disabled:opacity-50"
                    title="Email this invoice to the users marked 'Invoices' in Admin"
                  >
                    {invoiceBusy ? "Sending…" : "✉ Email invoice"}
                  </button>
                  <button
                    onClick={() => emailInvoice(true)}
                    disabled={invoiceBusy}
                    className="badge bg-surface px-3 py-1.5 text-xs font-semibold text-surface-muted hover:bg-surface-card disabled:opacity-50"
                  >
                    Send test to me
                  </button>
                  {invoiceMsg && <span className="text-xs text-surface-ink">{invoiceMsg}</span>}
                </div>
              </>
            ) : (
              <div className="text-sm text-surface-muted">
                No billing rate set for {facilityName}. Add a <b>Bill %</b> in{" "}
                <b>Admin → Facilities</b> to generate its invoice.
              </div>
            )}
          </div>
        )}

        <button
          onClick={download}
          disabled={
            loading ||
            downloading ||
            !month ||
            (monthPayments.length === 0 && monthBilled.length === 0)
          }
          className="btn-primary mt-4 disabled:opacity-50"
        >
          {downloading ? "Building…" : `↓ Download ${month ? monthLabel(month) : ""} bundle`}
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
