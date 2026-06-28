import * as XLSX from "xlsx";

export interface ParsedClaim {
  claim_id: string;
  facility_name: string;
  patient_name: string;
  member_id: string;
  dos_from: string;
  dos_to: string;
  charge_amount: number | null;
  balance: number | null;
  age_days: number | null;
  bucket: string;
  claim_status: string;
  notes: string;
  initials: string;
}

export interface ParseResult {
  format: "raw" | "grouped" | "unknown";
  claims: ParsedClaim[];
  notesNotInCurrent: { claim_id: string; notes: string }[];
  collectorAssignments: { facility: string; collectors: string[] }[];
  skippedVmah: number;
  sheetsParsed: string[];
}

const norm = (s: unknown): string =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const n = parseFloat(String(v).replace(/[$,]/g, "").trim());
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
    const h = headers[i];
    if (patterns.some((p) => p.test(h))) return i;
  }
  return -1;
}

function bucketToAge(bucket: string, explicit: number | null): number | null {
  if (explicit != null) return explicit;
  const b = bucket.toLowerCase();
  if (/65|66\+|over/.test(b)) return 70;
  if (/36|46|56/.test(b)) return 45;
  if (/0|1-|under|0-35/.test(b)) return 15;
  return null;
}

function deriveBucket(age: number | null): string {
  if (age == null) return "";
  if (age > 65) return "65+";
  if (age >= 36) return "36-65";
  return "0-35";
}

// VMAH-prefixed member IDs are excluded everywhere.
const isVmah = (memberId: string) =>
  memberId.toUpperCase().startsWith("VMAH");

// ----- raw flat export -----
function parseRaw(rows: unknown[][]): ParsedClaim[] | null {
  let headerRow = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i].map(norm);
    if (cells.some((c) => c.includes("office name")) &&
        cells.some((c) => c.includes("claim id"))) {
      headerRow = i;
      break;
    }
  }
  if (headerRow === -1) return null;

  const headers = rows[headerRow].map(norm);
  const col = {
    office: findCol(headers, [/office name/]),
    claim: findCol(headers, [/claim id/]),
    age: findCol(headers, [/age.*day|age \(days\)|^age$/]),
    patient: findCol(headers, [/patient full name|patient name|patient/]),
    member: findCol(headers, [/member id/]),
    from: findCol(headers, [/from/]),
    to: findCol(headers, [/to date|claim to/]),
    charge: findCol(headers, [/charge amount/]),
    balance: findCol(headers, [/charge balance|balance/]),
    status: findCol(headers, [/claim status|status/]),
  };

  const out: ParsedClaim[] = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    const claimId = toStr(r[col.claim]);
    if (!claimId) continue;
    const age = toNum(r[col.age]);
    out.push({
      claim_id: claimId,
      facility_name: toStr(r[col.office]),
      patient_name: toStr(r[col.patient]),
      member_id: toStr(r[col.member]),
      dos_from: col.from >= 0 ? toStr(r[col.from]) : "",
      dos_to: col.to >= 0 ? toStr(r[col.to]) : "",
      charge_amount: toNum(r[col.charge]),
      balance: toNum(r[col.balance]),
      age_days: age,
      bucket: deriveBucket(age),
      claim_status: col.status >= 0 ? toStr(r[col.status]) : "",
      notes: "",
      initials: "",
    });
  }
  return out;
}

// ----- grouped per-facility tabs -----
function parseGroupedSheet(
  facility: string,
  rows: unknown[][]
): ParsedClaim[] {
  // Header is typically at row 3 (index 2); locate the row containing "Claim ID".
  let headerRow = -1;
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    if (rows[i].map(norm).some((c) => c.includes("claim id"))) {
      headerRow = i;
      break;
    }
  }
  if (headerRow === -1) return [];

  const headers = rows[headerRow].map(norm);
  const col = {
    claim: findCol(headers, [/claim id/]),
    patient: findCol(headers, [/patient name|patient/]),
    member: findCol(headers, [/member id/]),
    from: findCol(headers, [/from/]),
    to: findCol(headers, [/to date|claim to/]),
    charge: findCol(headers, [/charge amount|charge entered|charge/]),
    balance: findCol(headers, [/balance/]),
    age: findCol(headers, [/age.*day|^age$|^days$/]),
    bucket: findCol(headers, [/age bucket|bucket/]),
    status: findCol(headers, [/status/]),
    notes: findCol(headers, [/notes/]),
    initials: findCol(headers, [/initials/]),
  };

  const out: ParsedClaim[] = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    const claimId = toStr(r[col.claim]);
    if (!claimId) continue;
    // Skip in-sheet section dividers like "0-35 DAYS • 172 claims" — real
    // claim ids have no spaces/bullets and contain digits.
    if (/[\s•]/.test(claimId) || !/\d/.test(claimId)) continue;
    const age = col.age >= 0 ? toNum(r[col.age]) : null;
    const bucket = col.bucket >= 0 ? toStr(r[col.bucket]) : "";
    out.push({
      claim_id: claimId,
      facility_name: facility,
      patient_name: col.patient >= 0 ? toStr(r[col.patient]) : "",
      member_id: col.member >= 0 ? toStr(r[col.member]) : "",
      dos_from: col.from >= 0 ? toStr(r[col.from]) : "",
      dos_to: col.to >= 0 ? toStr(r[col.to]) : "",
      charge_amount: col.charge >= 0 ? toNum(r[col.charge]) : null,
      balance: col.balance >= 0 ? toNum(r[col.balance]) : null,
      age_days: bucketToAge(bucket, age),
      bucket: bucket || deriveBucket(age),
      claim_status: col.status >= 0 ? toStr(r[col.status]) : "",
      notes: col.notes >= 0 ? toStr(r[col.notes]) : "",
      initials: col.initials >= 0 ? toStr(r[col.initials]) : "",
    });
  }
  return out;
}

export function parseWorkbook(data: ArrayBuffer): ParseResult {
  const wb = XLSX.read(data, { type: "array", cellDates: true });
  const result: ParseResult = {
    format: "unknown",
    claims: [],
    notesNotInCurrent: [],
    collectorAssignments: [],
    skippedVmah: 0,
    sheetsParsed: [],
  };

  // Try raw flat export on the first sheet first.
  const first = wb.Sheets[wb.SheetNames[0]];
  const firstRows = XLSX.utils.sheet_to_json<unknown[]>(first, {
    header: 1,
    blankrows: false,
  });
  const raw = parseRaw(firstRows);
  if (raw && raw.length) {
    result.format = "raw";
    result.sheetsParsed.push(wb.SheetNames[0]);
    result.claims = raw;
  } else {
    // Grouped report: iterate tabs.
    result.format = "grouped";
    for (const name of wb.SheetNames) {
      const n = norm(name);
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
        header: 1,
        blankrows: false,
      });

      if (n.includes("notes not in current")) {
        // (Claim ID + Notes)
        let hr = -1;
        for (let i = 0; i < Math.min(rows.length, 8); i++) {
          if (rows[i].map(norm).some((c) => c.includes("claim id"))) {
            hr = i;
            break;
          }
        }
        if (hr >= 0) {
          const headers = rows[hr].map(norm);
          const ci = findCol(headers, [/claim id/]);
          const ni = findCol(headers, [/notes/]);
          for (let i = hr + 1; i < rows.length; i++) {
            const cid = toStr(rows[i][ci]);
            if (cid)
              result.notesNotInCurrent.push({
                claim_id: cid,
                notes: ni >= 0 ? toStr(rows[i][ni]) : "",
              });
          }
        }
        continue;
      }

      if (n.includes("collector assignment")) {
        let hr = -1;
        for (let i = 0; i < Math.min(rows.length, 8); i++) {
          if (rows[i].map(norm).some((c) => c.includes("facility"))) {
            hr = i;
            break;
          }
        }
        if (hr >= 0) {
          const headers = rows[hr].map(norm);
          const fi = findCol(headers, [/facility/]);
          for (let i = hr + 1; i < rows.length; i++) {
            const fac = toStr(rows[i][fi]);
            if (!fac) continue;
            const collectors = rows[i]
              .filter((_, idx) => idx !== fi)
              .map(toStr)
              .filter(Boolean);
            result.collectorAssignments.push({ facility: fac, collectors });
          }
        }
        continue;
      }

      // Skip analytics / helper tabs that aren't facility claim lists.
      if (
        /summary|assignment plan|collector tracker|patient grouping|day patients|claims detail|horizon|3hzn|^_?lists$|^sheet\d+$/.test(
          n
        )
      ) {
        continue;
      }

      // Otherwise treat the tab as a facility.
      const claims = parseGroupedSheet(name, rows);
      if (claims.length) {
        result.sheetsParsed.push(name);
        result.claims.push(...claims);
      }
    }
  }

  // Merge "notes not in current" into claim notes by claim_id.
  if (result.notesNotInCurrent.length) {
    const noteMap = new Map(
      result.notesNotInCurrent.map((x) => [x.claim_id, x.notes])
    );
    for (const c of result.claims) {
      if (!c.notes && noteMap.has(c.claim_id)) {
        c.notes = noteMap.get(c.claim_id) ?? "";
      }
    }
  }

  // Exclude VMAH member IDs.
  const before = result.claims.length;
  result.claims = result.claims.filter((c) => !isVmah(c.member_id));
  result.skippedVmah = before - result.claims.length;

  return result;
}

// Normalize a facility name for fuzzy matching (drop legal suffixes/punctuation).
export function normFacility(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\b(llc|inc|ltd|the|recovery|center|services|care|treatment|solutions)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
