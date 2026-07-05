import * as XLSX from "xlsx";

// Shared helpers ------------------------------------------------------------
const norm = (s: unknown): string =>
  String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const n = parseFloat(String(v).replace(/[$,%]/g, "").trim());
  return isFinite(n) ? n : null;
}

function toStr(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    return `${v.getMonth() + 1}/${v.getDate()}/${v.getFullYear()}`;
  }
  return String(v).trim();
}

// Like toStr, but converts bare Excel date serial numbers (e.g. 46174) into a
// readable M/D/YYYY. Non-date values pass through unchanged.
function toDateStr(v: unknown): string {
  if (v == null || v === "") return "";
  if (v instanceof Date) {
    return `${v.getMonth() + 1}/${v.getDate()}/${v.getFullYear()}`;
  }
  if (typeof v === "number" && v > 20000 && v < 90000) {
    const d = new Date(Date.UTC(1899, 11, 30));
    d.setUTCDate(d.getUTCDate() + Math.round(v));
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
  }
  return String(v).trim();
}

function findCol(headers: string[], patterns: RegExp[]): number {
  for (let i = 0; i < headers.length; i++) {
    if (patterns.some((p) => p.test(headers[i]))) return i;
  }
  return -1;
}

function rowsOf(ws: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
}

function findHeaderRow(rows: unknown[][], needle: RegExp, limit = 5): number {
  for (let i = 0; i < Math.min(rows.length, limit); i++) {
    if (rows[i].map(norm).some((c) => needle.test(c))) return i;
  }
  return -1;
}

export interface TrackerParseResult<T> {
  rows: (T & { facility_name: string })[];
  facilities: string[];
  sheetsParsed: string[];
}

const SKIP_TAB = /summary|facilities|directory|^_?lists$|^sheet\d+$|instructions/;

// Authorization ------------------------------------------------------------
export interface AuthRow {
  patient_name: string;
  admit_date: string;
  start_date: string;
  end_date: string;
  discharge_date: string;
  next_review_date: string;
  auth_number: string;
  level_of_care: string;
  total_days: number | null;
  status: string;
  notes: string;
}

// Inclusive day count between two M/D/YYYY strings, or null if either is bad.
function inclusiveDays(start: string, end: string): number | null {
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (isNaN(a) || isNaN(b) || b < a) return null;
  return Math.round((b - a) / 86400000) + 1;
}

export function parseAuthorizations(
  data: ArrayBuffer
): TrackerParseResult<AuthRow> {
  const wb = XLSX.read(data, { type: "array", cellDates: true });
  const out: (AuthRow & { facility_name: string })[] = [];
  const sheets: string[] = [];

  for (const name of wb.SheetNames) {
    if (SKIP_TAB.test(norm(name))) continue;
    const rows = rowsOf(wb.Sheets[name]);
    const hr = findHeaderRow(rows, /admit|discharge|next review|level of care|\bloc\b/);
    if (hr < 0) continue;
    const h = rows[hr].map(norm);
    const col = {
      facility: findCol(h, [/facility|office|customer/]),
      patient: findCol(h, [/patient name|patient|name/]),
      admit: findCol(h, [/admit/]),
      start: findCol(h, [/start/]),
      end: findCol(h, [/^end|end date/]),
      discharge: findCol(h, [/discharge/]),
      review: findCol(h, [/review/]),
      auth: findCol(h, [/auth number|auth #|auth/]),
      loc: findCol(h, [/level of care|loc/]),
      days: findCol(h, [/total days|days approved|# days|# of days|^days$|days/]),
      status: findCol(h, [/status|approv/]),
      notes: findCol(h, [/notes/]),
    };
    let added = 0;
    // Facility may be a column (carried down a grouped list) rather than the
    // sheet name.
    let lastFacility = name;
    for (let i = hr + 1; i < rows.length; i++) {
      const r = rows[i];
      if (col.facility >= 0) {
        const f = toStr(r[col.facility]);
        if (f) lastFacility = f;
      }
      const patient = toStr(r[col.patient >= 0 ? col.patient : 0]);
      if (!patient) continue;
      const start = col.start >= 0 ? toDateStr(r[col.start]) : "";
      const end = col.end >= 0 ? toDateStr(r[col.end]) : "";
      // Prefer an explicit "days" column; otherwise derive from start/end.
      const days = col.days >= 0 ? toNum(r[col.days]) : null;
      out.push({
        facility_name: col.facility >= 0 ? lastFacility : name,
        patient_name: patient,
        admit_date: col.admit >= 0 ? toDateStr(r[col.admit]) : "",
        start_date: start,
        end_date: end,
        discharge_date: col.discharge >= 0 ? toDateStr(r[col.discharge]) : "",
        next_review_date: col.review >= 0 ? toDateStr(r[col.review]) : "",
        auth_number: col.auth >= 0 ? toStr(r[col.auth]) : "",
        level_of_care: col.loc >= 0 ? toStr(r[col.loc]) : "",
        total_days: days != null ? days : inclusiveDays(start, end),
        status: col.status >= 0 ? toStr(r[col.status]) : "Pending",
        notes: col.notes >= 0 ? toStr(r[col.notes]) : "",
      });
      added++;
    }
    if (added) sheets.push(name);
  }

  return {
    rows: out,
    facilities: Array.from(new Set(out.map((r) => r.facility_name))),
    sheetsParsed: sheets,
  };
}

// Negotiations -------------------------------------------------------------
export interface NegRow {
  patient_name: string;
  dos: string;
  vendor: string;
  carrier: string;
  charged_amount: number | null;
  proposed_amount: number | null;
  negotiated_amount: number | null;
  status: string;
  date_signed: string;
  extra_paid: number | null;
  proposed_rate: number | null;
  approved_rate: number | null;
  other_vendor: string;
  negotiator: string;
  work_date: string;
  notes: string;
}

export function parseNegotiations(data: ArrayBuffer): TrackerParseResult<NegRow> {
  const wb = XLSX.read(data, { type: "array", cellDates: true });
  const out: (NegRow & { facility_name: string })[] = [];
  const sheets: string[] = [];

  for (const name of wb.SheetNames) {
    if (SKIP_TAB.test(norm(name))) continue;
    const rows = rowsOf(wb.Sheets[name]);
    const hr = findHeaderRow(rows, /patient name|charged amount|negotiated/);
    if (hr < 0) continue;
    const h = rows[hr].map(norm);
    const col = {
      patient: findCol(h, [/patient name|patient/]),
      dos: findCol(h, [/date of service|^dos|service/]),
      vendor: findCol(h, [/name of vendor|^vendor/]),
      carrier: findCol(h, [/insurance carrier|carrier|payer/]),
      charged: findCol(h, [/charged amount|charged|charge/]),
      proposed: findCol(h, [/proposed amount/]),
      negotiated: findCol(h, [/negotiated amount/]),
      status: findCol(h, [/^status|approved|aproved/]),
      signed: findCol(h, [/date signed/]),
      extra: findCol(h, [/extra paid/]),
      prate: findCol(h, [/proposed rate/]),
      arate: findCol(h, [/approved rate/]),
      other: findCol(h, [/other vendor/]),
      negotiator: findCol(h, [/negotiator/]),
      work: findCol(h, [/work date/]),
      notes: findCol(h, [/notes/]),
    };
    let added = 0;
    for (let i = hr + 1; i < rows.length; i++) {
      const r = rows[i];
      const patient = toStr(r[col.patient >= 0 ? col.patient : 0]);
      if (!patient) continue;
      out.push({
        facility_name: name,
        patient_name: patient,
        dos: col.dos >= 0 ? toStr(r[col.dos]) : "",
        vendor: col.vendor >= 0 ? toStr(r[col.vendor]) : "",
        carrier: col.carrier >= 0 ? toStr(r[col.carrier]) : "",
        charged_amount: col.charged >= 0 ? toNum(r[col.charged]) : null,
        proposed_amount: col.proposed >= 0 ? toNum(r[col.proposed]) : null,
        negotiated_amount: col.negotiated >= 0 ? toNum(r[col.negotiated]) : null,
        status: col.status >= 0 ? toStr(r[col.status]) : "",
        date_signed: col.signed >= 0 ? toStr(r[col.signed]) : "",
        extra_paid: col.extra >= 0 ? toNum(r[col.extra]) : null,
        proposed_rate: col.prate >= 0 ? toNum(r[col.prate]) : null,
        approved_rate: col.arate >= 0 ? toNum(r[col.arate]) : null,
        other_vendor: col.other >= 0 ? toStr(r[col.other]) : "",
        negotiator: col.negotiator >= 0 ? toStr(r[col.negotiator]) : "",
        work_date: col.work >= 0 ? toStr(r[col.work]) : "",
        notes: col.notes >= 0 ? toStr(r[col.notes]) : "",
      });
      added++;
    }
    if (added) sheets.push(name);
  }

  return {
    rows: out,
    facilities: Array.from(new Set(out.map((r) => r.facility_name))),
    sheetsParsed: sheets,
  };
}

// Historical Data — BCBS prefix reference (global, state tabs) --------------
export interface HistoricalRow {
  state: string;
  year: string;
  prefix: string;
  prefix_length: string;
  payer: string;
  code_type: string;
  code_used: string;
  cpt_code: string;
  rev_code: string;
  description: string;
  billed_per_day: number | null;
  paid_per_day: number | null;
}

export function parseHistorical(data: ArrayBuffer): HistoricalRow[] {
  const wb = XLSX.read(data, { type: "array", cellDates: true });
  const out: HistoricalRow[] = [];
  for (const name of wb.SheetNames) {
    if (/^_?lists$|^summary$|^sheet\d+$/.test(norm(name))) continue;
    const rows = rowsOf(wb.Sheets[name]);
    const hr = findHeaderRow(rows, /prefix|payer/, 6);
    if (hr < 0) continue;
    const h = rows[hr].map(norm);
    const col = {
      state: findCol(h, [/^state$/, /state/]),
      year: findCol(h, [/year/]),
      prefix: findCol(h, [/^prefix$/]),
      plen: findCol(h, [/prefix length/]),
      payer: findCol(h, [/payer/]),
      ctype: findCol(h, [/code type/]),
      cused: findCol(h, [/code used/]),
      cpt: findCol(h, [/cpt code/]),
      rev: findCol(h, [/rev code/]),
      desc: findCol(h, [/description|cpt ?\/ ?rev/]),
      billed: findCol(h, [/billed/]),
      paid: findCol(h, [/paid/]),
    };
    for (let i = hr + 1; i < rows.length; i++) {
      const r = rows[i];
      const prefix = col.prefix >= 0 ? toStr(r[col.prefix]) : "";
      const payer = col.payer >= 0 ? toStr(r[col.payer]) : "";
      if (!prefix && !payer) continue;
      out.push({
        state: col.state >= 0 ? toStr(r[col.state]) : name,
        year: col.year >= 0 ? toStr(r[col.year]).replace(/\.0$/, "") : "",
        prefix,
        prefix_length: col.plen >= 0 ? toStr(r[col.plen]).replace(/\.0$/, "") : "",
        payer,
        code_type: col.ctype >= 0 ? toStr(r[col.ctype]) : "",
        code_used: col.cused >= 0 ? toStr(r[col.cused]) : "",
        cpt_code: col.cpt >= 0 ? toStr(r[col.cpt]) : "",
        rev_code: col.rev >= 0 ? toStr(r[col.rev]) : "",
        description: col.desc >= 0 ? toStr(r[col.desc]) : "",
        billed_per_day: col.billed >= 0 ? toNum(r[col.billed]) : null,
        paid_per_day: col.paid >= 0 ? toNum(r[col.paid]) : null,
      });
    }
  }
  return out;
}

// Weekly Assignments — from the COLLECTOR ASSIGNMENTS sheet -----------------
export interface AssignmentRow {
  collectors: string;
  billers: string;
  ur_specialist: string;
  repricing_specialist: string;
  pricing_specialist: string;
  notes: string;
}

export function parseAssignments(
  data: ArrayBuffer
): TrackerParseResult<AssignmentRow> {
  const wb = XLSX.read(data, { type: "array", cellDates: true });
  const out: (AssignmentRow & { facility_name: string })[] = [];
  const sheets: string[] = [];

  for (const name of wb.SheetNames) {
    const n = norm(name);
    if (!/collector assignment|assignment/.test(n)) continue;
    const rows = rowsOf(wb.Sheets[name]);
    const hr = findHeaderRow(rows, /facility/, 8);
    if (hr < 0) continue;
    const h = rows[hr].map(norm);
    const fi = findCol(h, [/facility/]);
    // Collect any "collector" columns (0-35 collectors, 36+ collector 1/2/3…).
    const collectorCols = h
      .map((c, i) => (/collector/.test(c) ? i : -1))
      .filter((i) => i >= 0);
    const billerCol = findCol(h, [/biller/]);
    const urCol = findCol(h, [/\bur\b|utilization/]);
    const repCol = findCol(h, [/repric/]);
    const priceCol = findCol(h, [/pricing/]);
    const noteCol = findCol(h, [/notes|rule/]);

    for (let i = hr + 1; i < rows.length; i++) {
      const r = rows[i];
      const fac = fi >= 0 ? toStr(r[fi]) : "";
      if (!fac) continue;
      const collectors = Array.from(
        new Set(
          collectorCols
            .map((ci) => toStr(r[ci]))
            .join(" / ")
            .split(/[\/,]/)
            .map((s) => s.trim())
            .filter(Boolean)
        )
      ).join(", ");
      out.push({
        facility_name: fac,
        collectors,
        billers: billerCol >= 0 ? toStr(r[billerCol]) : "",
        ur_specialist: urCol >= 0 ? toStr(r[urCol]) : "",
        repricing_specialist: repCol >= 0 ? toStr(r[repCol]) : "",
        pricing_specialist: priceCol >= 0 ? toStr(r[priceCol]) : "",
        notes: noteCol >= 0 ? toStr(r[noteCol]) : "",
      });
    }
    if (out.length) sheets.push(name);
  }
  return {
    rows: out,
    facilities: Array.from(new Set(out.map((r) => r.facility_name))),
    sheetsParsed: sheets,
  };
}

// Medical Records ----------------------------------------------------------
export interface MedRow {
  patient_name: string;
  dos_from: string;
  dos_to: string;
  charge_amount: number | null;
  payer: string;
  record_status: string;
  claim_status: string;
  date_received: string;
  dcn: string;
  pages: string;
  paid_amount: number | null;
  notes: string;
}

// Billed claims (CollaborateMD "Claims Billed Report") --------------------
// One facility per file (banner "Customer is X"). Carries the payer name, so
// it powers AR-by-payer and Billed-this-month on the facility dashboard.
export interface BilledRow {
  claim_id: string;
  times_billed: number | null;
  from_date: string;
  to_date: string;
  entered_date: string;
  total_amount: number | null;
  balance: number | null;
  patient_id: string;
  patient_name: string;
  payer_name: string;
  payer_type: string;
}

export function parseBilled(data: ArrayBuffer): TrackerParseResult<BilledRow> {
  const wb = XLSX.read(data, { type: "array", cellDates: true });
  const out: (BilledRow & { facility_name: string })[] = [];
  const sheets: string[] = [];

  for (const name of wb.SheetNames) {
    if (/total claims per patient|^_?lists$|^sheet\d+$/.test(norm(name))) continue;
    const rows = rowsOf(wb.Sheets[name]);
    // Facility from the "Customer is X" banner in the first few rows.
    let bannerFacility = name;
    for (let i = 0; i < Math.min(rows.length, 8); i++) {
      const joined = rows[i].map(toStr).join(" ");
      const m = joined.match(/customer is\s+(.+?)(?:\s{2,}|$)/i);
      if (m) {
        bannerFacility = m[1].trim();
        break;
      }
    }
    const hr = findHeaderRow(
      rows,
      /claim total amount|primary payer|claim balance|claim id/,
      10
    );
    if (hr < 0) continue;
    const h = rows[hr].map(norm);
    const col = {
      claim: findCol(h, [/^claim id$|claim id/]),
      times: findCol(h, [/times billed|cntall/]),
      from: findCol(h, [/from date/]),
      to: findCol(h, [/to date/]),
      entered: findCol(h, [/date entered|billed date/]),
      total: findCol(h, [/claim total amount|total amount/]),
      balance: findCol(h, [/claim balance|balance/]),
      patientId: findCol(h, [/patient id/]),
      patient: findCol(h, [/patient full name|patient name/]),
      payer: findCol(h, [/primary payer name|payer name|primary payer/]),
      ptype: findCol(h, [/payer type/]),
    };
    let added = 0;
    for (let i = hr + 1; i < rows.length; i++) {
      const r = rows[i];
      const claim = col.claim >= 0 ? toStr(r[col.claim]) : "";
      const patient = col.patient >= 0 ? toStr(r[col.patient]) : "";
      // A real row has both a claim id and a patient — this skips the footer
      // totals row (which has an aggregate count in the claim column and no
      // patient/payer).
      if (!claim || !patient) continue;
      out.push({
        facility_name: bannerFacility,
        claim_id: claim,
        times_billed: col.times >= 0 ? toNum(r[col.times]) : null,
        from_date: col.from >= 0 ? toDateStr(r[col.from]) : "",
        to_date: col.to >= 0 ? toDateStr(r[col.to]) : "",
        entered_date: col.entered >= 0 ? toDateStr(r[col.entered]) : "",
        total_amount: col.total >= 0 ? toNum(r[col.total]) : null,
        balance: col.balance >= 0 ? toNum(r[col.balance]) : null,
        patient_id: col.patientId >= 0 ? toStr(r[col.patientId]) : "",
        patient_name: patient,
        payer_name: col.payer >= 0 ? toStr(r[col.payer]) : "",
        payer_type: col.ptype >= 0 ? toStr(r[col.ptype]) : "",
      });
      added++;
    }
    if (added) sheets.push(name);
  }

  // De-dupe by claim id (last wins) so claim-id upsert stays unique.
  const byId = new Map<string, BilledRow & { facility_name: string }>();
  for (const r of out) byId.set(r.claim_id, r);
  const deduped = [...byId.values()];

  return {
    rows: deduped,
    facilities: Array.from(new Set(deduped.map((r) => r.facility_name).filter(Boolean))),
    sheetsParsed: sheets,
  };
}

// Payment (Facility Paid per CPT / Level of Care) -------------------------
export interface PaymentRow {
  payment_entered: string;
  deposit_date: string;
  patient_name: string;
  member_id: string;
  cpt_description: string;
  payment_source: string;
  dos_from: string;
  dos_to: string;
  charge_amount: number | null;
  paid_amount: number | null;
  payment_type: string;
  check_number: string;
  period: string; // YYYY-MM the payment belongs to (from deposit/entered date)
}

// The month (YYYY-MM) a date string belongs to, so payments accumulate by
// month: importing a new month adds to the running total; re-importing a month
// refreshes just that month. Handles MM/DD/YYYY, YYYY-MM-DD, and Date objects.
export function periodOf(...candidates: string[]): string {
  for (const raw of candidates) {
    const s = (raw || "").trim();
    if (!s) continue;
    let m = s.match(/^(\d{4})[-/](\d{1,2})[-/]\d{1,2}/); // YYYY-MM-DD
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
    m = s.match(/^(\d{1,2})[-/]\d{1,2}[-/](\d{2,4})/); // MM/DD/YYYY
    if (m) {
      const yr = m[2].length === 2 ? `20${m[2]}` : m[2];
      return `${yr}-${m[1].padStart(2, "0")}`;
    }
  }
  return "";
}

export function parsePayments(data: ArrayBuffer): TrackerParseResult<PaymentRow> {
  const wb = XLSX.read(data, { type: "array", cellDates: true });
  const out: (PaymentRow & { facility_name: string })[] = [];
  const sheets: string[] = [];

  for (const name of wb.SheetNames) {
    if (/^_?lists$|^sheet\d+$/.test(norm(name))) continue;
    const rows = rowsOf(wb.Sheets[name]);
    // Some exports carry one facility in a "Customer is X" banner; the
    // multi-facility export carries a per-row "Office Name" column (preferred).
    let bannerFacility = name;
    for (let i = 0; i < Math.min(rows.length, 6); i++) {
      const joined = rows[i].map(toStr).join(" ");
      const m = joined.match(/customer is\s+(.+?)(?:\s{2,}|$)/i);
      if (m) {
        bannerFacility = m[1].trim();
        break;
      }
    }
    const hr = findHeaderRow(rows, /payment entered|payment total paid|deposit date|office name/, 12);
    if (hr < 0) continue;
    const h = rows[hr].map(norm);
    const col = {
      office: findCol(h, [/office name/, /^office$/, /facility/]),
      entered: findCol(h, [/payment entered/]),
      deposit: findCol(h, [/deposit date/]),
      patient: findCol(h, [/patient full name|patient name|patient/]),
      member: findCol(h, [/member id/]),
      cpt: findCol(h, [/cpt descri|charge cpt|cpt/]),
      source: findCol(h, [/payment source|payer/]),
      from: findCol(h, [/from date|charge from/]),
      to: findCol(h, [/to date|charge to/]),
      charge: findCol(h, [/charge.*amount|charge\/debit/]),
      paid: findCol(h, [/total paid|payment total|paid/]),
      type: findCol(h, [/payment type/]),
      check: findCol(h, [/check/]),
    };
    let added = 0;
    for (let i = hr + 1; i < rows.length; i++) {
      const r = rows[i];
      const patient = col.patient >= 0 ? toStr(r[col.patient]) : "";
      if (!patient) continue;
      const office = col.office >= 0 ? toStr(r[col.office]) : "";
      const deposit = col.deposit >= 0 ? toStr(r[col.deposit]) : "";
      const entered = col.entered >= 0 ? toStr(r[col.entered]) : "";
      out.push({
        facility_name: office || bannerFacility,
        payment_entered: entered,
        deposit_date: deposit,
        patient_name: patient,
        member_id: col.member >= 0 ? toStr(r[col.member]) : "",
        cpt_description: col.cpt >= 0 ? toStr(r[col.cpt]) : "",
        payment_source: col.source >= 0 ? toStr(r[col.source]) : "",
        dos_from: col.from >= 0 ? toStr(r[col.from]) : "",
        dos_to: col.to >= 0 ? toStr(r[col.to]) : "",
        charge_amount: col.charge >= 0 ? toNum(r[col.charge]) : null,
        paid_amount: col.paid >= 0 ? toNum(r[col.paid]) : null,
        payment_type: col.type >= 0 ? toStr(r[col.type]) : "",
        check_number: col.check >= 0 ? toStr(r[col.check]) : "",
        // Which month this payment counts toward (deposit date first).
        period: periodOf(deposit, entered),
      });
      added++;
    }
    if (added) sheets.push(name);
  }
  return {
    rows: out,
    facilities: Array.from(new Set(out.map((r) => r.facility_name))),
    sheetsParsed: sheets,
  };
}

// Repricing / Renegotiations ----------------------------------------------
// Handles the June Renegotiations layout (Facility, Patient, Member ID,
// Claim ID, Claim Date, Charge, Amt Allowed, Payer, Remark Codes, Status,
// Note/Action, Follow Up, Additional Payment, Payment Status) and the older
// Remark Codes Pricing export. Claim ID is the stable key for note persistence.
export interface RepricingRow {
  claim_id: string;
  patient_name: string;
  member_id: string;
  claim_date: string;
  charge_amount: number | null;
  amt_allowed: number | null;
  payer: string;
  remark_codes: string;
  claim_status: string;
  note_action: string;
  follow_up: string;
  additional_payment: number | null;
  payment_status: string;
}

export function parseRepricing(
  data: ArrayBuffer
): TrackerParseResult<RepricingRow> {
  const wb = XLSX.read(data, { type: "array", cellDates: true });
  const out: (RepricingRow & { facility_name: string })[] = [];
  const sheets: string[] = [];

  for (const name of wb.SheetNames) {
    if (/^_?lists$|^sheet\d+$|^summary$/.test(norm(name))) continue;
    const rows = rowsOf(wb.Sheets[name]);
    // Match the real header (has "Claim ID") — not the title row, which on the
    // Renegotiations export reads "… Remark Code Pricing".
    const hr = findHeaderRow(rows, /claim id/, 12);
    if (hr < 0) continue;
    const h = rows[hr].map(norm);
    const col = {
      claim: findCol(h, [/claim id/]),
      office: findCol(h, [/facility name|office name|facility/]),
      patient: findCol(h, [/patient full name|patient name|patient/]),
      member: findCol(h, [/member id/]),
      date: findCol(h, [/claim date|from date|claim from/]),
      charge: findCol(h, [/charge amount|total amount|claim total/]),
      allowed: findCol(h, [/amt allowed|amount allowed|allowed|amount paid|claim amount paid/]),
      payer: findCol(h, [/primary payer|payer|carrier/]),
      remark: findCol(h, [/remark code/]),
      status: findCol(h, [/claim status|^status$|status$/]),
      note: findCol(h, [/note ?\/ ?action|note|action/]),
      follow: findCol(h, [/follow ?up/]),
      addl: findCol(h, [/additional payment|addl pmt|add'l/]),
      pstatus: findCol(h, [/payment status/]),
    };
    let added = 0;
    for (let i = hr + 1; i < rows.length; i++) {
      const r = rows[i];
      const claim = col.claim >= 0 ? toStr(r[col.claim]) : "";
      const patient = col.patient >= 0 ? toStr(r[col.patient]) : "";
      if (!claim && !patient) continue;
      out.push({
        facility_name: col.office >= 0 ? toStr(r[col.office]) : name,
        claim_id: claim,
        patient_name: patient,
        member_id: col.member >= 0 ? toStr(r[col.member]) : "",
        claim_date: col.date >= 0 ? toStr(r[col.date]) : "",
        charge_amount: col.charge >= 0 ? toNum(r[col.charge]) : null,
        amt_allowed: col.allowed >= 0 ? toNum(r[col.allowed]) : null,
        payer: col.payer >= 0 ? toStr(r[col.payer]) : "",
        remark_codes: col.remark >= 0 ? toStr(r[col.remark]) : "",
        claim_status: col.status >= 0 ? toStr(r[col.status]) : "",
        note_action: col.note >= 0 ? toStr(r[col.note]) : "",
        follow_up: col.follow >= 0 ? toStr(r[col.follow]) : "",
        additional_payment: col.addl >= 0 ? toNum(r[col.addl]) : null,
        payment_status: col.pstatus >= 0 ? toStr(r[col.pstatus]) : "",
      });
      added++;
    }
    if (added) sheets.push(name);
  }

  // De-dupe by claim id (last wins) so the claim-id upsert key is unique.
  const byId = new Map<string, (RepricingRow & { facility_name: string })>();
  const noId: (RepricingRow & { facility_name: string })[] = [];
  for (const r of out) {
    if (r.claim_id) byId.set(r.claim_id, r);
    else noId.push(r);
  }
  const deduped = [...byId.values(), ...noId];

  return {
    rows: deduped,
    facilities: Array.from(new Set(deduped.map((r) => r.facility_name).filter(Boolean))),
    sheetsParsed: sheets,
  };
}

export function parseMedicalRecords(
  data: ArrayBuffer
): TrackerParseResult<MedRow> {
  const wb = XLSX.read(data, { type: "array", cellDates: true });
  const out: (MedRow & { facility_name: string })[] = [];
  const sheets: string[] = [];

  // Medical records live on one sheet with a Facility Name column.
  for (const name of wb.SheetNames) {
    if (/^_?lists$|^sheet\d+$|^summary$/.test(norm(name))) continue;
    const rows = rowsOf(wb.Sheets[name]);
    const hr = findHeaderRow(rows, /record status|patient name|facility name/, 6);
    if (hr < 0) continue;
    const h = rows[hr].map(norm);
    const col = {
      facility: findCol(h, [/facility name|facility/]),
      patient: findCol(h, [/patient name|patient/]),
      from: findCol(h, [/dos from|from/]),
      to: findCol(h, [/dos to|to date|^to/]),
      charge: findCol(h, [/charge amount|charge/]),
      payer: findCol(h, [/payer|carrier|insurance/]),
      rstatus: findCol(h, [/record status/]),
      cstatus: findCol(h, [/claim status/]),
      received: findCol(h, [/date rec|received/]),
      dcn: findCol(h, [/dcn/]),
      pages: findCol(h, [/pages/]),
      paid: findCol(h, [/paid amount|paid/]),
      notes: findCol(h, [/notes/]),
    };
    let added = 0;
    for (let i = hr + 1; i < rows.length; i++) {
      const r = rows[i];
      const patient = col.patient >= 0 ? toStr(r[col.patient]) : "";
      if (!patient) continue;
      out.push({
        facility_name: col.facility >= 0 ? toStr(r[col.facility]) : "",
        patient_name: patient,
        dos_from: col.from >= 0 ? toStr(r[col.from]) : "",
        dos_to: col.to >= 0 ? toStr(r[col.to]) : "",
        charge_amount: col.charge >= 0 ? toNum(r[col.charge]) : null,
        payer: col.payer >= 0 ? toStr(r[col.payer]) : "",
        record_status: col.rstatus >= 0 ? toStr(r[col.rstatus]) : "",
        claim_status: col.cstatus >= 0 ? toStr(r[col.cstatus]) : "",
        date_received: col.received >= 0 ? toStr(r[col.received]) : "",
        dcn: col.dcn >= 0 ? toStr(r[col.dcn]) : "",
        pages: col.pages >= 0 ? toStr(r[col.pages]) : "",
        paid_amount: col.paid >= 0 ? toNum(r[col.paid]) : null,
        notes: col.notes >= 0 ? toStr(r[col.notes]) : "",
      });
      added++;
    }
    if (added) sheets.push(name);
  }

  return {
    rows: out,
    facilities: Array.from(new Set(out.map((r) => r.facility_name).filter(Boolean))),
    sheetsParsed: sheets,
  };
}
