"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/page";
import { periodOf } from "@/lib/import/parseTrackers";
import { buildMonthlyBundle } from "@/lib/report/monthlyBundle";
import ExportButton, { type ExportRow } from "@/components/overview/ExportButton";
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

  // ---- "All invoices" batch panel: see every facility's invoice for a month,
  // verify each, then send them all at once. ----
  type InvoiceRow = {
    facilityId: string;
    name: string;
    rate: number | null;
    collected: number;
    fee: number;
    ready: boolean;
    issue: string;
  };
  type SendResult = { name: string; ok: boolean; recipients?: number; error?: string; squareError?: string | null };
  const [allMonth, setAllMonth] = useState("");
  const [allMonths, setAllMonths] = useState<string[]>([]);
  const [allRows, setAllRows] = useState<InvoiceRow[]>([]);
  const [allLoading, setAllLoading] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchMsg, setBatchMsg] = useState("");
  const [batchResults, setBatchResults] = useState<SendResult[]>([]);

  // ---- Invoice tracker: sent invoices, Paid toggle, reminder status ----
  type InvoiceLedger = {
    id: string;
    facility_id: string;
    period: string;
    amount: number;
    sent_at: string;
    paid: boolean;
    paid_amount: number;
    reminders_sent: number;
  };
  const [ledger, setLedger] = useState<InvoiceLedger[]>([]);
  const [payMsg, setPayMsg] = useState("");
  const facName = useCallback(
    (id: string) => {
      const f = facilities.find((x) => x.id === id);
      return f?.short_name || f?.name || "Facility";
    },
    [facilities]
  );
  // Ledger-specific: if the invoice points at a facility record that no longer
  // exists (deleted/merged), don't hide it behind a generic "Facility" — surface
  // the id fragment so the orphaned invoice can be traced and remapped.
  const ledgerFacName = useCallback(
    (id: string) => {
      const f = facilities.find((x) => x.id === id);
      if (f) return f.short_name || f.name;
      return `Unknown facility · ${String(id ?? "").slice(0, 8)}…`;
    },
    [facilities]
  );
  const loadLedger = useCallback(async () => {
    // select("*") so this still works before the paid_amount migration is run.
    const { data } = await supabase
      .from("invoices")
      .select("*")
      .order("paid", { ascending: true })
      .order("sent_at", { ascending: false });
    setLedger(
      ((data as (InvoiceLedger & { paid_amount?: number })[]) ?? []).map((r) => ({
        ...r,
        paid_amount: Number(r.paid_amount ?? 0),
      }))
    );
  }, [supabase]);
  useEffect(() => {
    loadLedger();
  }, [loadLedger]);
  const balanceOf = (r: InvoiceLedger) =>
    Math.max(0, Math.round(((r.amount ?? 0) - (r.paid_amount ?? 0)) * 100) / 100);
  const setPaid = async (id: string, paid: boolean) => {
    const row = ledger.find((r) => r.id === id);
    // Checking "paid" records the full amount; unchecking reopens the balance.
    const paid_amount = paid ? row?.amount ?? 0 : row?.paid_amount ?? 0;
    setLedger((prev) => prev.map((r) => (r.id === id ? { ...r, paid, paid_amount } : r)));
    await supabase
      .from("invoices")
      .update({ paid, paid_amount, paid_at: paid ? new Date().toISOString() : null })
      .eq("id", id);
  };
  // Record a partial (or full) payment: set the total paid-so-far amount. When
  // it covers the invoice, the row flips to fully paid automatically.
  const recordPayment = async (r: InvoiceLedger, raw: string) => {
    const amt = parseFloat(raw.replace(/[$,]/g, ""));
    if (isNaN(amt) || amt < 0) {
      setPayMsg("Enter a valid dollar amount.");
      setTimeout(() => setPayMsg(""), 4000);
      return;
    }
    const paidAmount = Math.round(amt * 100) / 100;
    const nowFullyPaid = paidAmount >= (r.amount ?? 0) - 0.005;
    setLedger((prev) =>
      prev.map((x) =>
        x.id === r.id ? { ...x, paid_amount: paidAmount, paid: nowFullyPaid } : x
      )
    );
    const { error } = await supabase
      .from("invoices")
      .update({
        paid_amount: paidAmount,
        paid: nowFullyPaid,
        paid_at: nowFullyPaid ? new Date().toISOString() : null,
      })
      .eq("id", r.id);
    if (error) {
      setPayMsg(
        /paid_amount/.test(error.message)
          ? "Run migration 0054 (partial payments) in Supabase first."
          : `Error: ${error.message}`
      );
      setTimeout(() => setPayMsg(""), 8000);
      loadLedger();
    } else {
      setPayMsg(
        nowFullyPaid
          ? `${facName(r.facility_id)} paid in full.`
          : `Recorded — ${facName(r.facility_id)} balance ${money(balanceOf({ ...r, paid_amount: paidAmount }))}.`
      );
      setTimeout(() => setPayMsg(""), 5000);
    }
  };
  const reminderLabel = (n: number) =>
    n <= 0 ? "—" : n === 1 ? "7-day sent" : n === 2 ? "7/14 sent" : "7/14/30 done";

  // ---- Square payments: live read of what facilities actually paid ----
  type SquarePayment = {
    id: string;
    createdAt: string;
    amount: number;
    status: string;
    note: string | null;
    receiptUrl: string | null;
  };
  const [sqPayments, setSqPayments] = useState<SquarePayment[]>([]);
  const [sqLoading, setSqLoading] = useState(false);
  const [sqErr, setSqErr] = useState("");
  const [sqLoaded, setSqLoaded] = useState(false);
  const loadSquare = useCallback(async () => {
    setSqLoading(true);
    setSqErr("");
    try {
      const res = await fetch("/api/square-payments?days=60");
      const d = await res.json();
      if (!res.ok) {
        setSqErr(d.error || "Could not load Square payments.");
        setSqPayments([]);
      } else {
        setSqPayments((d.payments ?? []) as SquarePayment[]);
        if (d.error) setSqErr(d.error);
      }
    } catch {
      setSqErr("Could not reach Square.");
    } finally {
      setSqLoading(false);
      setSqLoaded(true);
    }
  }, []);
  // Best-effort match of a Square payment to an unpaid invoice by exact balance.
  const matchInvoice = useCallback(
    (amount: number) => {
      const hits = ledger.filter((r) => !r.paid && Math.abs(balanceOf(r) - amount) < 0.01);
      return hits.length === 1 ? hits[0] : null;
    },
    [ledger]
  );

  // Manually fire a payment reminder for one invoice, right now.
  const [remindingId, setRemindingId] = useState<string | null>(null);
  const [remindMsg, setRemindMsg] = useState("");
  const sendReminder = async (r: InvoiceLedger) => {
    if (
      !confirm(
        `Send a payment reminder to ${facName(r.facility_id)} for ${monthLabel(
          r.period
        )} (${money(r.amount)})?`
      )
    )
      return;
    setRemindingId(r.id);
    setRemindMsg("");
    try {
      const res = await fetch("/api/invoice-reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: r.id }),
      });
      const d = await res.json();
      if (!res.ok) {
        setRemindMsg(d.error || "Could not send the reminder.");
      } else {
        setRemindMsg(
          `✓ Reminder sent to ${facName(r.facility_id)} (${d.recipients} recipient${
            d.recipients === 1 ? "" : "s"
          }).`
        );
      }
    } catch {
      setRemindMsg("Could not send the reminder.");
    } finally {
      setRemindingId(null);
    }
  };

  // ---- Extra charges (late fees, adjustments) for the selected facility+month ----
  type Charge = { id: string; label: string; amount: number };
  const [charges, setCharges] = useState<Charge[]>([]);
  const [chLabel, setChLabel] = useState("");
  const [chAmount, setChAmount] = useState("");
  const [chMsg, setChMsg] = useState("");
  const loadCharges = useCallback(async () => {
    if (!facilityId || !month) {
      setCharges([]);
      return;
    }
    const { data } = await supabase
      .from("invoice_charges")
      .select("id,label,amount")
      .eq("facility_id", facilityId)
      .eq("period", month)
      .order("created_at");
    setCharges((data as Charge[]) ?? []);
  }, [supabase, facilityId, month]);
  useEffect(() => {
    loadCharges();
  }, [loadCharges]);
  const addCharge = async () => {
    const amt = parseFloat(chAmount);
    if (!chLabel.trim() || isNaN(amt)) {
      setChMsg("Enter a label and a dollar amount.");
      return;
    }
    setChMsg("Saving…");
    const { data, error } = await supabase
      .from("invoice_charges")
      .insert({ facility_id: facilityId, period: month, label: chLabel.trim(), amount: amt })
      .select("id,label,amount")
      .single();
    if (error) {
      // Most common cause: migration 0052 not run yet, so the table is missing.
      setChMsg(
        /invoice_charges|relation|does not exist|schema cache/i.test(error.message)
          ? "Couldn't save — run migration 0052_invoice_charges.sql in Supabase, then reload."
          : `Couldn't save: ${error.message}`
      );
      return; // keep what you typed so nothing is lost
    }
    if (data) setCharges((prev) => [...prev, data as Charge]);
    setChLabel("");
    setChAmount("");
    setChMsg("");
  };
  const removeCharge = async (id: string) => {
    setCharges((prev) => prev.filter((c) => c.id !== id));
    await supabase.from("invoice_charges").delete().eq("id", id);
  };
  const chargesTotal = charges.reduce((s, c) => s + (Number(c.amount) || 0), 0);

  const loadSummary = useCallback(async (m?: string) => {
    setAllLoading(true);
    try {
      const res = await fetch("/api/invoice-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(m ? { month: m } : {}),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBatchMsg(d.error || "Could not load invoices.");
        setAllRows([]);
        return;
      }
      if (Array.isArray(d.months)) setAllMonths(d.months);
      const rows = (d.invoices ?? []) as InvoiceRow[];
      setAllRows(rows);
      // Pre-check the ones that are ready to send.
      setChecked(new Set(rows.filter((r) => r.ready).map((r) => r.facilityId)));
    } catch {
      setBatchMsg("Could not load invoices.");
    } finally {
      setAllLoading(false);
    }
  }, []);

  // Discover months once, then reload whenever the batch month changes.
  useEffect(() => {
    loadSummary();
  }, [loadSummary]);
  useEffect(() => {
    if (allMonths.length && !allMonths.includes(allMonth)) setAllMonth(allMonths[0]);
  }, [allMonths, allMonth]);
  useEffect(() => {
    if (allMonth) loadSummary(allMonth);
  }, [allMonth, loadSummary]);

  const toggleChecked = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectedRows = allRows.filter((r) => checked.has(r.facilityId));
  const selectedTotal = selectedRows.reduce((s, r) => s + r.fee, 0);

  const sendAll = async () => {
    const toSend = selectedRows;
    if (!toSend.length) return;
    if (
      !confirm(
        `Send ${toSend.length} invoice(s) for ${monthLabel(allMonth)} — total ${money(selectedTotal)}?\n\n` +
          `Each facility's invoice goes to ITS OWN login; management marked "Invoices" is BCC'd. This sends real emails.`
      )
    )
      return;
    setBatchBusy(true);
    setBatchResults([]);
    const results: SendResult[] = [];
    for (const r of toSend) {
      setBatchMsg(`Sending ${r.name}… (${results.length + 1}/${toSend.length})`);
      try {
        const res = await fetch("/api/invoice-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ facilityId: r.facilityId, month: allMonth, test: false }),
        });
        const d = await res.json().catch(() => ({}));
        results.push({
          name: r.name,
          ok: res.ok,
          recipients: d.recipients,
          error: res.ok ? undefined : d.error || "send failed",
          squareError: d.squarePay === "none" ? d.squareError : null,
        });
      } catch {
        results.push({ name: r.name, ok: false, error: "network error" });
      }
      setBatchResults([...results]);
    }
    setBatchBusy(false);
    const okN = results.filter((r) => r.ok).length;
    setBatchMsg(`Done — ${okN}/${toSend.length} invoice(s) sent.`);
    // Refresh so amounts reflect any late-imported payments next time.
    loadSummary(allMonth);
    loadLedger();
  };
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
        const toList = (d.to ?? []) as string[];
        const bccList = (d.bcc ?? []) as string[];
        if (toList.length === 0 && bccList.length === 0) {
          setInvoiceMsg(
            d.diag || `${facilityName} has no login and no internal user is marked "Invoices".`
          );
          setInvoiceBusy(false);
          setTimeout(() => setInvoiceMsg(""), 15000);
          return;
        }
        const lines =
          `To (${facilityName}): ${toList.length ? toList.join(", ") : "— no facility login —"}` +
          (bccList.length ? `\nBCC (management): ${bccList.join(", ")}` : "");
        if (!confirm(`Send ${facilityName}'s ${monthLabel(month)} invoice?\n\n${lines}\n\nSend now?`)) {
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
      // If the Square "Pay" button couldn't be built, say why (helps set up Square).
      const sq =
        res.ok && data.squarePay === "none" && data.squareError
          ? ` ⚠ No Pay button — Square: ${data.squareError}`
          : res.ok && data.squarePay === "static-link"
            ? " (Pay button uses the facility's static Square link.)"
            : "";
      setInvoiceMsg(
        res.ok
          ? (test
              ? `✓ Test invoice sent to you${who}.`
              : `✓ Invoice emailed to ${data.recipients ?? 0} recipient(s)${who}.`) + sq
          : `Error: ${data.error || "could not send"}`
      );
    } catch {
      setInvoiceMsg("Error: could not send");
    } finally {
      setInvoiceBusy(false);
      setTimeout(() => setInvoiceMsg(""), 15000);
      loadLedger();
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
                  {money(totalCollected * (billingRate / 100) + chargesTotal)}
                </div>
                <div className="text-xs text-surface-muted">
                  {billingRate}% of {money(totalCollected)} = {money(totalCollected * (billingRate / 100))} billing fee
                  {chargesTotal !== 0 ? ` + ${money(chargesTotal)} charges` : ""} · included as an INVOICE sheet
                </div>

                {/* Extra charges: late fees, adjustments. Added to the invoice total. */}
                <div className="mt-3 rounded-md border border-surface-border bg-surface/60 p-2.5">
                  <div className="label mb-1">Extra charges</div>
                  {charges.length > 0 && (
                    <ul className="mb-2 space-y-1">
                      {charges.map((c) => (
                        <li key={c.id} className="flex items-center justify-between text-sm">
                          <span className="text-surface-ink">{c.label}</span>
                          <span className="flex items-center gap-2">
                            <span className="font-mono font-semibold">{money(c.amount)}</span>
                            <button
                              onClick={() => removeCharge(c.id)}
                              className="text-xs text-risk hover:underline"
                              title="Remove charge"
                            >
                              remove
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={chLabel}
                      onChange={(e) => setChLabel(e.target.value)}
                      placeholder="e.g. Late fee"
                      className="input h-8 flex-1 min-w-[8rem] text-sm"
                    />
                    <input
                      value={chAmount}
                      onChange={(e) => setChAmount(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addCharge()}
                      type="number"
                      step="0.01"
                      placeholder="$"
                      className="input h-8 w-24 text-sm"
                    />
                    <button
                      onClick={addCharge}
                      disabled={!chLabel.trim() || chAmount.trim() === ""}
                      className="badge bg-surface px-3 py-1.5 text-xs font-semibold text-surface-ink hover:bg-surface-card disabled:opacity-50"
                    >
                      + Add charge
                    </button>
                  </div>
                  {chMsg && (
                    <div
                      className={`mt-1 text-[11px] ${/couldn't|enter a/i.test(chMsg) ? "text-risk" : "text-surface-muted"}`}
                    >
                      {chMsg}
                    </div>
                  )}
                  <p className="mt-1 text-[11px] text-surface-muted">
                    Charges are added to this facility&apos;s {monthLabel(month)} invoice total, the
                    Square Pay amount, and any reminders. Use a negative amount for a credit.
                  </p>
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

      {/* ---- All invoices: verify every facility, then send them all ---- */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold">All invoices — send in one batch</h2>
            <p className="mt-1 text-sm text-surface-muted">
              Every facility&apos;s invoice for the month. Verify each one, then send them all at once.
            </p>
          </div>
          <label className="block">
            <span className="label">Month</span>
            <select
              value={allMonth}
              onChange={(e) => setAllMonth(e.target.value)}
              className="input"
              disabled={allLoading || allMonths.length === 0}
            >
              {allMonths.length === 0 && <option value="">No data</option>}
              {allMonths.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {allLoading ? (
          <div className="mt-4 text-sm text-surface-muted">Loading invoices…</div>
        ) : allRows.length === 0 ? (
          <div className="mt-4 text-sm text-surface-muted">No facilities to invoice.</div>
        ) : (
          <>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-surface-muted">
                    <th className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        aria-label="Select all ready"
                        checked={
                          selectedRows.length > 0 &&
                          allRows.filter((r) => r.ready).every((r) => checked.has(r.facilityId))
                        }
                        onChange={(e) =>
                          setChecked(
                            e.target.checked
                              ? new Set(allRows.filter((r) => r.ready).map((r) => r.facilityId))
                              : new Set()
                          )
                        }
                        className="h-4 w-4"
                      />
                    </th>
                    <th className="px-2 py-1.5">Facility</th>
                    <th className="px-2 py-1.5 text-right">Collected</th>
                    <th className="px-2 py-1.5 text-right">Rate</th>
                    <th className="px-2 py-1.5 text-right">Amount due</th>
                    <th className="px-2 py-1.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {allRows.map((r) => {
                    const res = batchResults.find((b) => b.name === r.name);
                    return (
                      <tr key={r.facilityId} className="border-t border-surface-border">
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={checked.has(r.facilityId)}
                            disabled={!r.ready || batchBusy}
                            onChange={() => toggleChecked(r.facilityId)}
                            className="h-4 w-4"
                          />
                        </td>
                        <td className="px-2 py-1.5 font-medium text-surface-ink">{r.name}</td>
                        <td className="px-2 py-1.5 text-right">{money(r.collected)}</td>
                        <td className="px-2 py-1.5 text-right">
                          {r.rate != null && r.rate > 0 ? `${r.rate}%` : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right font-semibold text-secured">
                          {r.rate != null && r.rate > 0 ? money(r.fee) : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-xs">
                          {res ? (
                            res.ok ? (
                              <span className="text-recovered">
                                ✓ sent{res.recipients != null ? ` (${res.recipients})` : ""}
                              </span>
                            ) : (
                              <span className="text-risk">✕ {res.error}</span>
                            )
                          ) : r.issue ? (
                            <span className="text-warn">{r.issue}</span>
                          ) : (
                            <span className="text-surface-muted">Ready</span>
                          )}
                          {res?.squareError && (
                            <span className="block text-[11px] text-warn">
                              No Pay button — {res.squareError}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-surface-border font-semibold">
                    <td />
                    <td className="px-2 py-2">{selectedRows.length} selected</td>
                    <td />
                    <td />
                    <td className="px-2 py-2 text-right text-secured">{money(selectedTotal)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                onClick={sendAll}
                disabled={batchBusy || selectedRows.length === 0}
                className="btn-primary disabled:opacity-50"
              >
                {batchBusy
                  ? "Sending…"
                  : `✉ Send ${selectedRows.length} invoice${selectedRows.length === 1 ? "" : "s"} · ${money(selectedTotal)}`}
              </button>
              {batchMsg && <span className="text-xs text-surface-ink">{batchMsg}</span>}
            </div>
            <p className="mt-2 text-[11px] text-surface-muted">
              Only facilities with a Bill % and a recipient marked &quot;Invoices&quot; can be
              checked. Each invoice goes to its own facility login; management is BCC&apos;d.
            </p>
          </>
        )}
      </div>

      {/* ---- Invoice tracker: who still owes + reminder status ---- */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold">Invoice tracker &amp; reminders</h2>
          {ledger.length > 0 && (
            <ExportButton
              label="Export"
              filename="invoice-tracker.xlsx"
              sheet="Invoices"
              rows={ledger.map(
                (r): ExportRow => ({
                  Facility: ledgerFacName(r.facility_id),
                  Month: monthLabel(r.period),
                  Amount: r.amount ?? 0,
                  "Paid to date": r.paid_amount ?? 0,
                  Balance: balanceOf(r),
                  Sent: new Date(r.sent_at).toLocaleDateString("en-US"),
                  Reminders: r.paid ? "—" : reminderLabel(r.reminders_sent),
                  Status: r.paid ? "Paid" : r.paid_amount > 0 ? "Partial" : "Unpaid",
                })
              )}
            />
          )}
        </div>
        <p className="mt-1 text-sm text-surface-muted">
          Every invoice you&apos;ve emailed. Record a <b>partial payment</b> and the <b>Balance</b>
          updates automatically; when the balance hits $0 the invoice flips to fully <b>Paid</b>.
          Unpaid balances get a reminder at <b>7, 14, and 30 days</b>, then stop — or hit{" "}
          <b>Send reminder</b> to nudge sooner.
        </p>
        {(remindMsg || payMsg) && (
          <p className="mt-2 text-sm font-medium text-secured">{remindMsg || payMsg}</p>
        )}
        {ledger.length === 0 ? (
          <div className="mt-4 text-sm text-surface-muted">
            No invoices sent yet. Email one above and it&apos;ll show here.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-surface-muted">
                  <th className="px-2 py-1.5">Facility</th>
                  <th className="px-2 py-1.5">Month</th>
                  <th className="px-2 py-1.5 text-right">Amount</th>
                  <th className="px-2 py-1.5 text-right">Paid</th>
                  <th className="px-2 py-1.5 text-right">Balance</th>
                  <th className="px-2 py-1.5">Record payment</th>
                  <th className="px-2 py-1.5">Reminders</th>
                  <th className="px-2 py-1.5 text-center">Paid in full</th>
                  <th className="px-2 py-1.5 text-right">Remind</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((r) => (
                  <tr
                    key={r.id}
                    className={`border-t border-surface-border ${r.paid ? "opacity-55" : ""}`}
                  >
                    <td className="px-2 py-1.5 font-medium text-surface-ink">
                      {ledgerFacName(r.facility_id)}
                    </td>
                    <td className="px-2 py-1.5">{monthLabel(r.period)}</td>
                    <td className="px-2 py-1.5 text-right font-semibold text-secured">
                      {money(r.amount)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-recovered">
                      {money(r.paid_amount)}
                    </td>
                    <td
                      className={`px-2 py-1.5 text-right font-mono font-semibold ${
                        balanceOf(r) > 0 ? "text-risk" : "text-surface-muted"
                      }`}
                    >
                      {money(balanceOf(r))}
                    </td>
                    <td className="px-2 py-1.5">
                      {r.paid ? (
                        <span className="text-xs text-surface-muted">Paid in full</span>
                      ) : (
                        <PaymentInput current={r.paid_amount} onSave={(v) => recordPayment(r, v)} />
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-xs text-surface-muted">
                      {r.paid ? "—" : reminderLabel(r.reminders_sent)}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={r.paid}
                        onChange={(e) => setPaid(r.id, e.target.checked)}
                        className="h-4 w-4"
                        aria-label={`Mark ${facName(r.facility_id)} ${monthLabel(r.period)} paid in full`}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {r.paid ? (
                        <span className="text-xs text-surface-muted">—</span>
                      ) : (
                        <button
                          onClick={() => sendReminder(r)}
                          disabled={remindingId === r.id}
                          className="btn-ghost px-2.5 py-1 text-xs"
                        >
                          {remindingId === r.id ? "Sending…" : "Send reminder"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---- Square payments: what facilities actually paid (live) ---- */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-lg font-bold">Square payments</h2>
            <p className="mt-1 text-sm text-surface-muted">
              Live from Square — payments received in the last 60 days. Match one to an invoice and
              hit <b>Apply</b> to mark it paid.
            </p>
          </div>
          <button onClick={loadSquare} disabled={sqLoading} className="btn-primary">
            {sqLoading ? "Loading…" : sqLoaded ? "↻ Refresh" : "Load Square payments"}
          </button>
        </div>

        {sqErr && (
          <p className="mt-3 rounded-lg bg-risk/10 px-3 py-2 text-sm text-risk">{sqErr}</p>
        )}

        {sqLoaded && !sqErr && sqPayments.length === 0 && (
          <p className="mt-3 text-sm text-surface-muted">
            No Square payments in the last 60 days.
          </p>
        )}

        {sqPayments.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-surface-muted">
                  <th className="px-2 py-1.5">Date</th>
                  <th className="px-2 py-1.5 text-right">Amount</th>
                  <th className="px-2 py-1.5">Status</th>
                  <th className="px-2 py-1.5">Note</th>
                  <th className="px-2 py-1.5">Matches invoice</th>
                  <th className="px-2 py-1.5">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {sqPayments.map((p) => {
                  const match = matchInvoice(p.amount);
                  const done = /COMPLETED|APPROVED/i.test(p.status);
                  return (
                    <tr key={p.id} className="border-t border-surface-border">
                      <td className="px-2 py-1.5 text-xs text-surface-muted">
                        {p.createdAt ? new Date(p.createdAt).toLocaleDateString("en-US") : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono font-semibold text-recovered">
                        {money(p.amount)}
                      </td>
                      <td className="px-2 py-1.5">
                        <span
                          className={`badge ${
                            done ? "bg-recovered/15 text-recovered" : "bg-gold/15 text-gold"
                          }`}
                        >
                          {p.status || "—"}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-xs text-surface-muted">{p.note || "—"}</td>
                      <td className="px-2 py-1.5 text-xs">
                        {match ? (
                          <span className="flex items-center gap-2">
                            <span className="text-surface-ink">
                              {facName(match.facility_id)} · {monthLabel(match.period)}
                            </span>
                            <button
                              onClick={() => recordPayment(match, String(match.amount))}
                              className="btn-ghost px-2 py-0.5 text-[11px]"
                            >
                              Apply
                            </button>
                          </span>
                        ) : (
                          <span className="text-surface-muted">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-xs">
                        {p.receiptUrl ? (
                          <a
                            href={p.receiptUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-brand-blue hover:underline"
                          >
                            View
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-surface-muted">
              &ldquo;Matches invoice&rdquo; shows when a payment&apos;s amount equals an unpaid
              invoice&apos;s remaining balance. Always confirm it&apos;s the right facility before
              applying.
            </p>
          </div>
        )}
      </div>

      <p className="text-xs text-surface-muted">
        Tip: import each month&apos;s Payment and Billed reports first (Payments / Billed tabs),
        then come here to package them. Re-import a month anytime — the bundle always reflects the
        latest.
      </p>
    </div>
  );
}

// Inline control to record how much a facility has paid on an invoice so far.
// Holds its own draft so typing doesn't re-render the whole ledger.
function PaymentInput({
  current,
  onSave,
}: {
  current: number;
  onSave: (value: string) => void;
}) {
  const [v, setV] = useState(current ? String(current) : "");
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-surface-muted">$</span>
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave(v);
        }}
        placeholder="paid to date"
        className="input w-28 px-2 py-1 text-xs"
      />
      <button onClick={() => onSave(v)} className="btn-ghost px-2 py-1 text-xs">
        Save
      </button>
    </div>
  );
}
