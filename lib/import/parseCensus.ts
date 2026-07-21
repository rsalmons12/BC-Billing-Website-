import * as XLSX from "xlsx";

export interface CensusRow {
  level_of_care: string;
  patient_name: string;
  admit_date: string;
  insurance: string;
  member_id: string;
  auth: string;
  comments: string;
  notes: string;
  step_up: string;
  repriced: string;
  days: Record<string, string>; // { "YYYY-MM-DD": "GN/CM" }
  week_start: string; // YYYY-MM-DD (earliest day column)
  week_label: string; // e.g. "3/23–3/28"
}

export interface CensusParseResult {
  rows: CensusRow[];
  weeks: string[]; // distinct week_start values found
}

const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();

function fromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function isoDate(v: unknown): string {
  if (v instanceof Date) return fromDate(v);
  const s = String(v ?? "").trim();
  if (!s) return "";
  // Pull an explicit M/D/YY(YY) out of the text so weekday-labelled day headers
  // like "Tues 2/17/26" or "Thurs 2/19/26" still resolve to a date.
  const m = s.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    const mo = Number(m[1]);
    const da = Number(m[2]);
    let yr = Number(m[3]);
    if (yr < 100) yr += 2000;
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
      return `${yr}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
    }
  }
  const t = Date.parse(s);
  if (isNaN(t)) return "";
  return fromDate(new Date(t));
}

function mdLabel(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${Number(m[2])}/${Number(m[3])}`;
}

function cellStr(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return `${v.getMonth() + 1}/${v.getDate()}/${v.getFullYear()}`;
  return String(v).trim();
}

// Tabs that are not weekly census grids.
const SKIP = new Set(["summary", "blank template"]);

export function parseCensus(data: ArrayBuffer): CensusParseResult {
  const wb = XLSX.read(data, { type: "array", cellDates: true });
  const rows: CensusRow[] = [];
  const weeks = new Set<string>();

  for (const name of wb.SheetNames) {
    if (SKIP.has(norm(name))) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
      header: 1,
      blankrows: false,
    });

    // Find the header row: has "Level of Care" plus a name column, which may be
    // a single "Name" or split into "First Name" / "Last Name".
    let hr = -1;
    for (let i = 0; i < Math.min(grid.length, 25); i++) {
      const cells = grid[i].map(norm);
      const hasName =
        cells.includes("name") ||
        cells.includes("first name") ||
        cells.includes("last name");
      if (cells.includes("level of care") && hasName) {
        hr = i;
        break;
      }
    }
    if (hr === -1) continue;

    const header = grid[hr];
    const idx = (...labels: string[]) =>
      header.findIndex((h) => labels.includes(norm(h)));
    const col = {
      loc: idx("level of care"),
      name: idx("name"),
      first: idx("first name", "first"),
      last: idx("last name", "last"),
      admit: idx("admit date", "admit", "admit date "),
      insurance: idx("insurance"),
      counselor: idx("counselor", "collector"),
      member: idx("member id"),
      auth: idx("auth", "authorization"),
      comments: idx("comments"),
      notes: idx("notes"),
      stepUp: idx("step-up", "step up"),
      repriced: idx("repriced"),
    };

    // Day columns = any header cell that parses as a date.
    const dayCols: { col: number; iso: string }[] = [];
    for (let c = 0; c < header.length; c++) {
      const iso = isoDate(header[c]);
      if (iso) dayCols.push({ col: c, iso });
    }
    if (dayCols.length === 0) continue;
    const weekStart = dayCols.map((d) => d.iso).sort()[0];
    const weekEnd = dayCols.map((d) => d.iso).sort().slice(-1)[0];
    const weekLabel = `${mdLabel(weekStart)}–${mdLabel(weekEnd)}`;

    for (let r = hr + 1; r < grid.length; r++) {
      const row = grid[r];
      // Patient name: a single "Name" cell, else "Last, First" from the split
      // columns. Rows without a name (section dividers like "CENSUS - WOODBURY",
      // legend text) are skipped.
      let patient = col.name >= 0 ? cellStr(row[col.name]) : "";
      if (!patient && (col.first >= 0 || col.last >= 0)) {
        const f = col.first >= 0 ? cellStr(row[col.first]) : "";
        const l = col.last >= 0 ? cellStr(row[col.last]) : "";
        patient = f && l ? `${l}, ${f}` : l || f;
      }
      if (!patient) continue;

      const days: Record<string, string> = {};
      let hasDay = false;
      for (const d of dayCols) {
        const code = cellStr(row[d.col]);
        if (code) {
          days[d.iso] = code;
          hasDay = true;
        }
      }
      const loc = col.loc >= 0 ? cellStr(row[col.loc]) : "";
      if (!loc && !hasDay) continue;

      // Counselor rides along in notes (there's no dedicated counselor column
      // on the census table), alongside any Notes column.
      const noteParts: string[] = [];
      if (col.counselor >= 0 && cellStr(row[col.counselor]))
        noteParts.push(`Counselor: ${cellStr(row[col.counselor])}`);
      if (col.notes >= 0 && cellStr(row[col.notes]))
        noteParts.push(cellStr(row[col.notes]));

      rows.push({
        level_of_care: loc,
        patient_name: patient,
        admit_date: col.admit >= 0 ? cellStr(row[col.admit]) : "",
        insurance: col.insurance >= 0 ? cellStr(row[col.insurance]) : "",
        member_id: col.member >= 0 ? cellStr(row[col.member]) : "",
        auth: col.auth >= 0 ? cellStr(row[col.auth]) : "",
        comments: col.comments >= 0 ? cellStr(row[col.comments]) : "",
        notes: noteParts.join(" — "),
        step_up: col.stepUp >= 0 ? cellStr(row[col.stepUp]) : "",
        repriced: col.repriced >= 0 ? cellStr(row[col.repriced]) : "",
        days,
        week_start: weekStart,
        week_label: weekLabel,
      });
      weeks.add(weekStart);
    }
  }

  return { rows, weeks: Array.from(weeks).sort() };
}

// Service codes we tally at the top of a week (order matters for display).
export const CENSUS_SESSION_CODES = ["GN", "CM", "PF", "PE", "ID", "IA", "FS"] as const;

// Count how many times each session code appears across a set of day cells.
export function tallySessions(rows: { days: Record<string, string> }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of CENSUS_SESSION_CODES) out[c] = 0;
  for (const r of rows) {
    for (const code of Object.values(r.days)) {
      // A day cell can hold several codes joined by / (e.g. "GN/CM/PF").
      for (const part of String(code).split(/[/,]/)) {
        const key = part.trim().toUpperCase().replace(/\s+/g, " ");
        // Match leading service code (ignore trailing LOC text like "IOP3").
        for (const sc of CENSUS_SESSION_CODES) {
          if (key === sc) out[sc] += 1;
        }
      }
    }
  }
  return out;
}
