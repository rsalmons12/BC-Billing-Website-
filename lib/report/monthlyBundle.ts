import * as XLSX from "xlsx";
import type { Payment, BilledClaim } from "@/lib/types";
import type { RepricingRow } from "@/lib/import/parseTrackers";

const num = (v: unknown) => (typeof v === "number" ? v : 0);

// Build the monthly reporting bundle (matches the NJRS bundle layout):
//   SUMMARY · Check Numbers · PATIENT DEPOSITS · BILLED REPORT
// from a facility's payments + billed claims + repricing for one month.
export function buildMonthlyBundle({
  facilityName,
  monthLabel,
  payments,
  billed,
  repricing,
}: {
  facilityName: string;
  monthLabel: string; // e.g. "April 2026"
  payments: Payment[];
  billed: BilledClaim[];
  repricing: RepricingRow[];
}): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const MONTH = monthLabel.toUpperCase();
  type Row = (string | number | null)[];

  const totalCollected = payments.reduce((s, p) => s + num(p.paid_amount), 0);
  const totalBilled = billed.reduce((s, b) => s + num(b.total_amount), 0);

  // ---- SUMMARY ----------------------------------------------------------
  // Collected per CPT / level of care.
  const cptMap = new Map<string, { charge: number; paid: number; n: number }>();
  for (const p of payments) {
    const k = p.cpt_description || "—";
    const cur = cptMap.get(k) ?? { charge: 0, paid: 0, n: 0 };
    cur.charge += num(p.charge_amount);
    cur.paid += num(p.paid_amount);
    cur.n += 1;
    cptMap.set(k, cur);
  }
  // Collected by payer.
  const payerMap = new Map<string, number>();
  for (const p of payments) {
    const k = p.payment_source || "—";
    payerMap.set(k, (payerMap.get(k) ?? 0) + num(p.paid_amount));
  }

  const summary: Row[] = [
    [`${facilityName} — ${monthLabel} Monthly Report`],
    [],
    ["Total Collected", totalCollected],
    ["Total Billed", totalBilled],
    ["Payments (lines)", payments.length],
    ["Billed claims", billed.length],
    [],
    ["Billed Totals Collected (per CPT / Level of Care)"],
    [
      "CPT Short Description",
      "Charge Amount",
      "Payment Total",
      "Charge (Avg)",
      "Paid (Avg)",
      "Percent Paid (Avg)",
    ],
  ];
  for (const [cpt, v] of Array.from(cptMap.entries()).sort((a, b) => b[1].paid - a[1].paid)) {
    summary.push([
      cpt,
      round(v.charge),
      round(v.paid),
      round(v.n ? v.charge / v.n : 0),
      round(v.n ? v.paid / v.n : 0),
      round(v.charge ? (v.paid / v.charge) * 100 : 0),
    ]);
  }
  summary.push([], ["Collected by Payer"], ["Payer", "Insurance Paid Amount"]);
  for (const [payer, amt] of Array.from(payerMap.entries()).sort((a, b) => b[1] - a[1])) {
    summary.push([payer, round(amt)]);
  }
  if (repricing.length) {
    summary.push(
      [],
      ["Repriced Patients"],
      ["Patient", "Member ID", "DOS", "Billed Amount", "Paid Amount", "Payer", "Remark", "Status"]
    );
    for (const r of repricing) {
      summary.push([
        r.patient_name,
        r.member_id,
        r.claim_date,
        round(num(r.charge_amount)),
        round(num(r.additional_payment ?? r.amt_allowed)),
        r.payer,
        r.remark_codes,
        r.claim_status,
      ]);
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "SUMMARY");

  // ---- Check Numbers ----------------------------------------------------
  const checkMap = new Map<string, number>();
  for (const p of payments) {
    const k = p.check_number || "";
    if (!k) continue;
    checkMap.set(k, (checkMap.get(k) ?? 0) + num(p.paid_amount));
  }
  const checks: Row[] = [["Payment Check #", "Insurance Paid Amount (Sum)"]];
  for (const [k, v] of Array.from(checkMap.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    checks.push([k, round(v)]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(checks), "Check Numbers");

  // ---- PATIENT DEPOSITS -------------------------------------------------
  const deposits: Row[] = [
    [`Customer is ${facilityName}`],
    [`Payments for ${monthLabel}`],
    [],
    [
      "Payment Entered",
      "Deposit Date",
      "Charge From Date",
      "Charge CPT",
      "Patient ID",
      "Patient Full Name",
      "Payer",
      "Insurance Paid Amount",
      "Payment Check #",
    ],
  ];
  for (const p of payments) {
    deposits.push([
      p.payment_entered,
      p.deposit_date,
      p.dos_from,
      p.cpt_description,
      p.member_id,
      p.patient_name,
      p.payment_source,
      round(num(p.paid_amount)),
      p.check_number,
    ]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(deposits), "PATIENT DEPOSITS");

  // ---- BILLED REPORT ----------------------------------------------------
  const billedRows: Row[] = [
    [`${MONTH} TOTAL BILLED`, round(totalBilled)],
    [],
    [
      "Patient Full Name",
      "Claim From Date",
      "Claim To Date",
      "Claim Date Entered",
      "Claim Total Amount",
      "Claim Primary Payer Name",
    ],
  ];
  for (const b of billed) {
    billedRows.push([
      b.patient_name,
      b.from_date,
      b.to_date,
      b.entered_date,
      round(num(b.total_amount)),
      b.payer_name,
    ]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(billedRows), "BILLED REPORT");

  return wb;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
