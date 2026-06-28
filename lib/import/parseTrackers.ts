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
  status: string;
  notes: string;
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
    const hr = findHeaderRow(rows, /admit date|auth number|level of care/);
    if (hr < 0) continue;
    const h = rows[hr].map(norm);
    const col = {
      patient: findCol(h, [/patient name|patient|name/]),
      admit: findCol(h, [/admit/]),
      start: findCol(h, [/start/]),
      end: findCol(h, [/^end|end date/]),
      discharge: findCol(h, [/discharge/]),
      review: findCol(h, [/review/]),
      auth: findCol(h, [/auth number|auth #|auth/]),
      loc: findCol(h, [/level of care|loc/]),
      status: findCol(h, [/status|approv/]),
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
        admit_date: col.admit >= 0 ? toStr(r[col.admit]) : "",
        start_date: col.start >= 0 ? toStr(r[col.start]) : "",
        end_date: col.end >= 0 ? toStr(r[col.end]) : "",
        discharge_date: col.discharge >= 0 ? toStr(r[col.discharge]) : "",
        next_review_date: col.review >= 0 ? toStr(r[col.review]) : "",
        auth_number: col.auth >= 0 ? toStr(r[col.auth]) : "",
        level_of_care: col.loc >= 0 ? toStr(r[col.loc]) : "",
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
