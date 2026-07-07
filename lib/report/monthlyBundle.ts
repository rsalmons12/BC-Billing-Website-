import ExcelJS from "exceljs";
import type { Payment, BilledClaim, Claim, Negotiation } from "@/lib/types";
import type { RepricingRow } from "@/lib/import/parseTrackers";

const num = (v: unknown) => (typeof v === "number" ? v : 0);
const MONEY = '$#,##0.00';
const INT = "#,##0";
const PCT = '0.0"%"';

// palette
const NAVY = "FF13294B";
const SLATE = "FF32507E";
const HEADER = "FFE7ECF3";
const ZEBRA = "FFF5F7FA";
const TOTAL = "FFDCE6D5";

function payerFromStatus(status: unknown): string {
  const t = String(status ?? "").trim();
  if (!t) return "Unassigned";
  const m = t.match(/\bat\s+(.+)$/i);
  if (!m) return "Other";
  const p = m[1].split(/\s{2,}|[|,;]/)[0].trim();
  return p ? p.toUpperCase() : "Other";
}
const round = (n: number) => Math.round(n * 100) / 100;

type ColSpec = { header: string; key: string; width: number; money?: boolean; int?: boolean; pct?: boolean };

// Builds the monthly reporting bundle as a styled .xlsx (returns bytes).
export async function buildMonthlyBundle({
  facilityName,
  monthLabel,
  payments,
  billed,
  repricing,
  claims = [],
  negotiations = [],
}: {
  facilityName: string;
  monthLabel: string;
  payments: Payment[];
  billed: BilledClaim[];
  repricing: RepricingRow[];
  claims?: Claim[];
  negotiations?: Negotiation[];
}): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "BC Billing";

  // ---- styling helpers ----
  const title = (ws: ExcelJS.Worksheet, text: string, span: number) => {
    const r = ws.addRow([text]);
    ws.mergeCells(r.number, 1, r.number, span);
    r.height = 24;
    const c = r.getCell(1);
    c.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.alignment = { vertical: "middle" };
    return r;
  };
  const section = (ws: ExcelJS.Worksheet, text: string, span: number) => {
    ws.addRow([]);
    const r = ws.addRow([text]);
    ws.mergeCells(r.number, 1, r.number, span);
    r.height = 18;
    const c = r.getCell(1);
    c.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SLATE } };
    c.alignment = { vertical: "middle" };
  };
  // A table with a bold header row, formatted body, optional total row.
  const table = (
    ws: ExcelJS.Worksheet,
    cols: ColSpec[],
    rows: Record<string, unknown>[],
    totalRow?: Record<string, unknown>
  ) => {
    const hr = ws.addRow(cols.map((c) => c.header));
    hr.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER } };
      cell.border = { bottom: { style: "thin", color: { argb: "FFB8C2D0" } } };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    rows.forEach((row, i) => {
      const r = ws.addRow(cols.map((c) => row[c.key] ?? ""));
      if (i % 2 === 1)
        r.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
        });
      cols.forEach((c, ci) => {
        const cell = r.getCell(ci + 1);
        if (c.money) cell.numFmt = MONEY;
        else if (c.int) cell.numFmt = INT;
        else if (c.pct) cell.numFmt = PCT;
      });
    });
    if (totalRow) {
      const r = ws.addRow(cols.map((c) => totalRow[c.key] ?? ""));
      r.eachCell((cell) => {
        cell.font = { bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL } };
      });
      cols.forEach((c, ci) => {
        const cell = r.getCell(ci + 1);
        if (c.money) cell.numFmt = MONEY;
        else if (c.int) cell.numFmt = INT;
        else if (c.pct) cell.numFmt = PCT;
      });
    }
    ws.columns.forEach((col, i) => {
      if (cols[i]) col.width = cols[i].width;
    });
  };
  const kv = (ws: ExcelJS.Worksheet, label: string, value: number | string, money = false) => {
    const r = ws.addRow([label, value]);
    r.getCell(1).font = { bold: true };
    if (money) r.getCell(2).numFmt = MONEY;
  };

  const totalCollected = payments.reduce((s, p) => s + num(p.paid_amount), 0);
  const totalBilled = billed.reduce((s, b) => s + num(b.total_amount), 0);

  // ===== SUMMARY =====
  const sum = wb.addWorksheet("SUMMARY");
  title(sum, `${facilityName} — ${monthLabel} Monthly Report`, 6);
  sum.addRow([]);
  kv(sum, "Total Collected", round(totalCollected), true);
  kv(sum, "Total Billed", round(totalBilled), true);
  kv(sum, "Payments (lines)", payments.length);
  kv(sum, "Billed claims", billed.length);

  const cptMap = new Map<string, { charge: number; paid: number; n: number }>();
  for (const p of payments) {
    const k = p.cpt_description || "—";
    const cur = cptMap.get(k) ?? { charge: 0, paid: 0, n: 0 };
    cur.charge += num(p.charge_amount);
    cur.paid += num(p.paid_amount);
    cur.n += 1;
    cptMap.set(k, cur);
  }
  section(sum, "Billed Totals Collected (per CPT / Level of Care)", 6);
  table(
    sum,
    [
      { header: "CPT / Level of Care", key: "cpt", width: 34 },
      { header: "Charge Amount", key: "charge", width: 16, money: true },
      { header: "Payment Total", key: "paid", width: 16, money: true },
      { header: "Charge (Avg)", key: "avgc", width: 14, money: true },
      { header: "Paid (Avg)", key: "avgp", width: 14, money: true },
      { header: "% Paid (Avg)", key: "pct", width: 13, pct: true },
    ],
    Array.from(cptMap.entries())
      .sort((a, b) => b[1].paid - a[1].paid)
      .map(([cpt, v]) => ({
        cpt,
        charge: round(v.charge),
        paid: round(v.paid),
        avgc: round(v.n ? v.charge / v.n : 0),
        avgp: round(v.n ? v.paid / v.n : 0),
        pct: round(v.charge ? (v.paid / v.charge) * 100 : 0),
      }))
  );

  const payerMap = new Map<string, number>();
  for (const p of payments) {
    const k = p.payment_source || "—";
    payerMap.set(k, (payerMap.get(k) ?? 0) + num(p.paid_amount));
  }
  section(sum, "Collected by Payer", 6);
  table(
    sum,
    [
      { header: "Payer", key: "payer", width: 34 },
      { header: "Insurance Paid Amount", key: "amt", width: 20, money: true },
    ],
    Array.from(payerMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([payer, amt]) => ({ payer, amt: round(amt) })),
    { payer: "TOTAL", amt: round(totalCollected) }
  );

  if (repricing.length) {
    section(sum, "Repriced Patients", 8);
    table(
      sum,
      [
        { header: "Patient", key: "pt", width: 22 },
        { header: "Member ID", key: "mid", width: 16 },
        { header: "DOS", key: "dos", width: 12 },
        { header: "Billed", key: "billed", width: 14, money: true },
        { header: "Paid", key: "paid", width: 14, money: true },
        { header: "Payer", key: "payer", width: 18 },
        { header: "Remark", key: "remark", width: 16 },
        { header: "Status", key: "status", width: 14 },
      ],
      repricing.map((r) => ({
        pt: r.patient_name,
        mid: r.member_id,
        dos: r.claim_date,
        billed: round(num(r.charge_amount)),
        paid: round(num(r.additional_payment ?? r.amt_allowed)),
        payer: r.payer,
        remark: r.remark_codes,
        status: r.claim_status,
      }))
    );
  }

  // ===== COLLECTION SUMMARY (aggregates only) =====
  const coll = wb.addWorksheet("COLLECTION SUMMARY");
  title(coll, `${facilityName} — Collection Summary`, 5);
  const arMap = new Map<string, { bal: number; n: number }>();
  for (const c of claims) {
    const bal = num(c.balance);
    if (bal <= 0) continue;
    const k = payerFromStatus(c.claim_status);
    const cur = arMap.get(k) ?? { bal: 0, n: 0 };
    cur.bal += bal;
    cur.n += 1;
    arMap.set(k, cur);
  }
  const totalAR = Array.from(arMap.values()).reduce((s, v) => s + v.bal, 0);
  section(coll, "Outstanding AR by Payer", 3);
  table(
    coll,
    [
      { header: "Payer", key: "payer", width: 34 },
      { header: "Outstanding AR", key: "ar", width: 18, money: true },
      { header: "Claims", key: "n", width: 10, int: true },
    ],
    Array.from(arMap.entries())
      .sort((a, b) => b[1].bal - a[1].bal)
      .map(([payer, v]) => ({ payer, ar: round(v.bal), n: v.n })),
    { payer: "TOTAL AR", ar: round(totalAR), n: claims.filter((c) => num(c.balance) > 0).length }
  );

  const negByCarrier = new Map<
    string,
    { charged: number; proposed: number; negotiated: number; n: number }
  >();
  const negByStatus = new Map<string, { negotiated: number; n: number }>();
  for (const g of negotiations) {
    const carrier = (g.carrier || "—").toUpperCase();
    const c = negByCarrier.get(carrier) ?? { charged: 0, proposed: 0, negotiated: 0, n: 0 };
    c.charged += num(g.charged_amount);
    c.proposed += num(g.proposed_amount);
    c.negotiated += num(g.negotiated_amount ?? g.approved_rate);
    c.n += 1;
    negByCarrier.set(carrier, c);
    const st = (g.status || "—").trim() || "—";
    const s = negByStatus.get(st) ?? { negotiated: 0, n: 0 };
    s.negotiated += num(g.negotiated_amount ?? g.approved_rate);
    s.n += 1;
    negByStatus.set(st, s);
  }
  section(coll, "Negotiations by Carrier", 5);
  table(
    coll,
    [
      { header: "Carrier", key: "carrier", width: 26 },
      { header: "Charged", key: "charged", width: 15, money: true },
      { header: "Proposed", key: "proposed", width: 15, money: true },
      { header: "Negotiated", key: "negotiated", width: 15, money: true },
      { header: "Deals", key: "n", width: 9, int: true },
    ],
    Array.from(negByCarrier.entries())
      .sort((a, b) => b[1].negotiated - a[1].negotiated)
      .map(([carrier, v]) => ({
        carrier,
        charged: round(v.charged),
        proposed: round(v.proposed),
        negotiated: round(v.negotiated),
        n: v.n,
      }))
  );
  section(coll, "Negotiations by Status", 3);
  table(
    coll,
    [
      { header: "Status", key: "status", width: 22 },
      { header: "Deals", key: "n", width: 10, int: true },
      { header: "Negotiated Total", key: "negotiated", width: 18, money: true },
    ],
    Array.from(negByStatus.entries())
      .sort((a, b) => b[1].negotiated - a[1].negotiated)
      .map(([status, v]) => ({ status, n: v.n, negotiated: round(v.negotiated) }))
  );

  // ===== Check Numbers =====
  const checkMap = new Map<string, number>();
  for (const p of payments) {
    const k = p.check_number || "";
    if (!k) continue;
    checkMap.set(k, (checkMap.get(k) ?? 0) + num(p.paid_amount));
  }
  const chk = wb.addWorksheet("Check Numbers");
  title(chk, `${facilityName} — Check Numbers · ${monthLabel}`, 2);
  chk.addRow([]);
  table(
    chk,
    [
      { header: "Payment Check #", key: "check", width: 24 },
      { header: "Insurance Paid Amount (Sum)", key: "amt", width: 26, money: true },
    ],
    Array.from(checkMap.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([check, amt]) => ({ check, amt: round(amt) }))
  );
  chk.views = [{ state: "frozen", ySplit: 3 }];

  // ===== PATIENT DEPOSITS =====
  const dep = wb.addWorksheet("PATIENT DEPOSITS");
  title(dep, `${facilityName} — Patient Deposits · ${monthLabel}`, 9);
  dep.addRow([]);
  table(
    dep,
    [
      { header: "Payment Entered", key: "entered", width: 15 },
      { header: "Deposit Date", key: "deposit", width: 13 },
      { header: "Charge From", key: "from", width: 13 },
      { header: "CPT / Level of Care", key: "cpt", width: 26 },
      { header: "Patient ID", key: "pid", width: 14 },
      { header: "Patient Full Name", key: "pt", width: 24 },
      { header: "Payer", key: "payer", width: 18 },
      { header: "Insurance Paid", key: "paid", width: 15, money: true },
      { header: "Check #", key: "check", width: 16 },
    ],
    payments.map((p) => ({
      entered: p.payment_entered,
      deposit: p.deposit_date,
      from: p.dos_from,
      cpt: p.cpt_description,
      pid: p.member_id,
      pt: p.patient_name,
      payer: p.payment_source,
      paid: round(num(p.paid_amount)),
      check: p.check_number,
    }))
  );
  dep.views = [{ state: "frozen", ySplit: 3 }];

  // ===== BILLED REPORT =====
  const bil = wb.addWorksheet("BILLED REPORT");
  title(bil, `${facilityName} — Billed Report · ${monthLabel}`, 6);
  kv(bil, `${monthLabel} Total Billed`, round(totalBilled), true);
  table(
    bil,
    [
      { header: "Patient Full Name", key: "pt", width: 24 },
      { header: "Claim From Date", key: "from", width: 15 },
      { header: "Claim To Date", key: "to", width: 15 },
      { header: "Claim Date Entered", key: "entered", width: 17 },
      { header: "Claim Total Amount", key: "amt", width: 17, money: true },
      { header: "Primary Payer", key: "payer", width: 22 },
    ],
    billed.map((b) => ({
      pt: b.patient_name,
      from: b.from_date,
      to: b.to_date,
      entered: b.entered_date,
      amt: round(num(b.total_amount)),
      payer: b.payer_name,
    }))
  );
  bil.views = [{ state: "frozen", ySplit: 3 }];

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
