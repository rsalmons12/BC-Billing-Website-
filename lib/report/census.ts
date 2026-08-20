import { CENSUS_LOC_GN, censusLocRate } from "@/lib/types";

// ---------------------------------------------------------------------------
// Census summary math — the SAME rules the Census tab uses, factored out so the
// Overview can show each facility's current-week census (patients), missed
// groups (GN), and missed revenue. Missed sessions are per service; only GN
// drives missed revenue. Expected reimbursement = 30% of billed.
// ---------------------------------------------------------------------------

const WEEKLY_RULES: Record<string, number> = { CM: 1, ID: 1 };
export const CENSUS_REQ_CODES = ["GN", "CM", "ID"] as const;
const EXPECTED_PCT = 0.3;

export type CensusLike = {
  facility_id: string | null;
  level_of_care: string | null;
  week_start: string | null;
  gn_rate: number | null;
  patient_name: string | null;
  days: Record<string, string> | null;
  admit_date?: string | null;
};

// Per-GN billed rate: a per-row override if set, else the standard rate for the
// level of care (PHP $4,800 / IOP $4,300 per GN).
function rateFor(r: CensusLike): number {
  if (r.gn_rate != null && r.gn_rate > 0) return r.gn_rate;
  return censusLocRate(r.level_of_care);
}

// GN sessions expected per week for a level of care (mapped value, else any
// number embedded in the name like "IOP CO 5" → 5).
function locProgramDays(loc: string | null): number {
  const key = String(loc ?? "").trim().replace(/\s+/g, " ");
  for (const [name, gn] of Object.entries(CENSUS_LOC_GN))
    if (name.toUpperCase() === key.toUpperCase()) return gn;
  const m = key.match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

const pad2 = (v: string | number) => String(Number(v)).padStart(2, "0");

// Normalize a stored admit-date cell ("8/13/2026", "8/13/26", "2026-08-13", or
// a bare "8/13") to ISO YYYY-MM-DD so it can be compared against day-column
// dates. A bare M/D with no year borrows the year from the census week.
function toIsoDate(raw: string | null | undefined, weekStart?: string | null): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${pad2(iso[2])}-${pad2(iso[3])}`;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/);
  if (m) {
    let yr: number;
    if (m[3]) {
      yr = Number(m[3]);
      if (yr < 100) yr += 2000;
    } else {
      yr = Number(String(weekStart ?? "").slice(0, 4));
      if (!yr) return ""; // no year anywhere → treat admit as unknown
    }
    return `${yr}-${pad2(m[1])}-${pad2(m[2])}`;
  }
  return "";
}

type ProrateRow = {
  level_of_care: string | null;
  admit_date?: string | null;
  week_start?: string | null;
  days?: Record<string, string> | null;
};

// The dates a facility actually held groups in a week = the union of every
// coded day-cell across that week's rows. If a group met on a date, at least
// one patient has a code there, so the union reconstructs the week's real
// group calendar (which handles holidays / short weeks automatically).
export function weekGroupDates(rows: { days?: Record<string, string> | null }[]): string[] {
  const s = new Set<string>();
  for (const r of rows) for (const iso of Object.keys(r.days ?? {})) s.add(iso);
  return Array.from(s).sort();
}

// Session requirements for ONE patient in a week, prorated to their admit date.
// A patient admitted mid-week is only accountable for the group-days that fell
// ON OR AFTER their admit date (capped at the level of care's weekly frequency),
// so a client who admitted Wednesday on an IOP-6 program isn't charged with
// "missing" Monday and Tuesday groups they were never there for. A patient with
// no admit date on file keeps the full weekly expectation, and a client admitted
// after the last group of the week owes nothing that week.
export function proratedRequirements(
  row: ProrateRow,
  groupDates: string[]
): Record<string, number> {
  const freq = locProgramDays(row.level_of_care);
  const full = { GN: freq, CM: WEEKLY_RULES.CM, ID: WEEKLY_RULES.ID };
  const admit = toIsoDate(row.admit_date, row.week_start);
  // No admit date, or no group calendar yet (week not started / no attendance
  // entered) → nothing to prorate against, so keep the full expectation.
  if (!admit || groupDates.length === 0) return full;
  const available = groupDates.filter((d) => d >= admit).length;
  if (available <= 0) return { GN: 0, CM: 0, ID: 0 };
  return { GN: Math.min(freq, available), CM: WEEKLY_RULES.CM, ID: WEEKLY_RULES.ID };
}

// Count each service code across a patient's day cells.
function actualsFor(days: Record<string, string> | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const code of Object.values(days ?? {}))
    for (const part of String(code).split(/[/,]/)) {
      const k = part.trim().toUpperCase();
      if (k) out[k] = (out[k] ?? 0) + 1;
    }
  return out;
}

// A readable label for an ISO week start: "Week of Jul 13".
export function censusWeekLabel(iso: string | null): string {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso || "—";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `Week of ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export interface CensusWeekSummary {
  facilityId: string;
  week: string | null; // ISO week_start of the reported (prior) week
  weekLabel: string;
  patients: number; // census — patients on the reported week
  missed: Record<string, number>; // GN / CM / ID missed sessions
  missedGroups: number; // missed GN specifically
  missedRev: number; // revenue lost to missed GN
  expected: number; // expected revenue for the week
}

// Summarize the census rows for one specific week of one facility.
function summarizeWeek(
  facilityId: string,
  weekRows: CensusLike[],
  week: string | null
): CensusWeekSummary {
  const missed: Record<string, number> = {};
  for (const c of CENSUS_REQ_CODES) missed[c] = 0;
  let missedRev = 0;
  let expected = 0;
  const patients = new Set<string>();
  const groupDates = weekGroupDates(weekRows);
  for (const r of weekRows) {
    const act = actualsFor(r.days);
    const req = proratedRequirements(r, groupDates);
    for (const c of CENSUS_REQ_CODES) missed[c] += Math.max(0, req[c] - (act[c] ?? 0));
    const missedGN = Math.max(0, req.GN - (act.GN ?? 0));
    missedRev += missedGN * rateFor(r) * EXPECTED_PCT;
    expected += rateFor(r) * (act.GN ?? 0) * EXPECTED_PCT;
    patients.add(String(r.patient_name ?? "").trim().toLowerCase() || Math.random().toString());
  }
  return {
    facilityId,
    week,
    weekLabel: censusWeekLabel(week),
    patients: patients.size,
    missed,
    missedGroups: missed.GN,
    missedRev,
    expected,
  };
}

// Summarize ONE facility's PRIOR census week (the last completed week — the
// current week is usually still in progress). Falls back to the only week when
// there's no prior week yet.
export function facilityCensusWeek(facilityId: string, rows: CensusLike[]): CensusWeekSummary | null {
  const fRows = rows.filter((r) => r.facility_id === facilityId && r.week_start);
  if (fRows.length === 0) return null;
  // Distinct weeks, oldest→newest. Prior week = the one before the most recent;
  // if only one week exists, use it (nothing prior to fall back to).
  const distinctWeeks = Array.from(new Set(fRows.map((r) => r.week_start!))).sort();
  const week = distinctWeeks[distinctWeeks.length - 2] ?? distinctWeeks[distinctWeeks.length - 1];
  return summarizeWeek(facilityId, fRows.filter((r) => r.week_start === week), week);
}

// The CURRENT census week and the week before it, for a side-by-side "this week
// vs last week" comparison. current = the most recent week on file; prior = the
// week before it (null when there's only one week of census yet).
export function facilityCensusCompare(
  facilityId: string,
  rows: CensusLike[]
): { current: CensusWeekSummary | null; prior: CensusWeekSummary | null } {
  const fRows = rows.filter((r) => r.facility_id === facilityId && r.week_start);
  if (fRows.length === 0) return { current: null, prior: null };
  const distinctWeeks = Array.from(new Set(fRows.map((r) => r.week_start!))).sort();
  const curWeek = distinctWeeks[distinctWeeks.length - 1];
  const priWeek = distinctWeeks[distinctWeeks.length - 2] ?? null;
  return {
    current: summarizeWeek(facilityId, fRows.filter((r) => r.week_start === curWeek), curWeek),
    prior: priWeek
      ? summarizeWeek(facilityId, fRows.filter((r) => r.week_start === priWeek), priWeek)
      : null,
  };
}

// Summarize every facility's most-recent week (facilities with no census are
// skipped).
export function censusByFacility(
  facilityIds: string[],
  rows: CensusLike[]
): CensusWeekSummary[] {
  return facilityIds
    .map((id) => facilityCensusWeek(id, rows))
    .filter((s): s is CensusWeekSummary => s !== null);
}
