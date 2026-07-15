import * as XLSX from "xlsx";

export interface CensusRow {
  level_of_care: string;
  patient_name: string;
  admit_date: string;
  insurance: string;
  member_id: string;
  auth: string;
  comments: string;
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

function isoDate(v: unknown): string {
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(
      v.getDate()
    ).padStart(2, "0")}`;
  }
  const t = Date.parse(String(v ?? "").trim());
  if (isNaN(t)) return "";
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
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

    // Find the header row (has "Level of Care" and "Name").
    let hr = -1;
    for (let i = 0; i < Math.min(grid.length, 20); i++) {
      const cells = grid[i].map(norm);
      if (cells.includes("level of care") && cells.includes("name")) {
        hr = i;
        break;
      }
    }
    if (hr === -1) continue;

    const header = grid[hr];
    const idx = (label: string) => header.findIndex((h) => norm(h) === label);
    const col = {
      loc: idx("level of care"),
      name: idx("name"),
      admit: idx("admit date"),
      insurance: idx("insurance"),
      member: idx("member id"),
      auth: idx("auth"),
      comments: idx("comments"),
      stepUp: idx("step-up"),
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
      const patient = cellStr(row[col.name]);
      if (!patient) continue;
      // Skip trailing note/legend rows that lack a level of care AND days.
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

      rows.push({
        level_of_care: loc,
        patient_name: patient,
        admit_date: col.admit >= 0 ? cellStr(row[col.admit]) : "",
        insurance: col.insurance >= 0 ? cellStr(row[col.insurance]) : "",
        member_id: col.member >= 0 ? cellStr(row[col.member]) : "",
        auth: col.auth >= 0 ? cellStr(row[col.auth]) : "",
        comments: col.comments >= 0 ? cellStr(row[col.comments]) : "",
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
