import type { SupabaseClient } from "@supabase/supabase-js";
import { money } from "@/lib/format";
import { isExcludedMember, isRiskPayer, isStaleClaim } from "@/lib/claims";
import { computeOutlooks, type FacilityOutlook } from "./moneyOutlook";
import {
  facilityCensusCompare,
  missedGroupDetail,
  type CensusWeekSummary,
  type MissedGroupRow,
} from "./census";
import { bucketByStatus, type StatusBucket } from "./statusBuckets";

// ---------------------------------------------------------------------------
// Facility daily recap — a faithful copy of what a facility sees on ITS OWN
// dashboard (/facility): Total AR, Expected Revenue, Collected & Billed this
// month, the Money Outlook, non-reimbursement risk, AR by payer, payments by
// payer, and negotiations. Scoped to one facility and mailed to that facility's
// login. Nothing management-only (no charged/recovered, no per-claim tables).
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
type Admin = SupabaseClient<any, any, any>;

// The share of outstanding AR a facility is projected to collect (dashboard rule).
const EXPECTED_RATE = 0.33;
// Negotiated dollars land ~14 days after the approval/signed date.
const NEG_PAY_LAG_DAYS = 14;

// Page through a table 1000 rows at a time. Works with the service-role client
// (no RLS) OR a facility's own session client (RLS scopes it to their facility).
async function pageAll<T>(client: Admin, build: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await build(client).range(from, from + 999);
    const rows = (data as T[]) ?? [];
    if (error) break;
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

type ClaimRow = {
  facility_id: string;
  claim_id: string | null;
  member_id: string | null;
  patient_name: string | null;
  balance: number | null;
  age_days: number | null;
  claim_status: string | null;
};
type HistRow = {
  prefix: string | null;
  cpt_code: string | null;
  code_used: string | null;
  paid_per_day: number | null;
};
type PayRow = {
  facility_id: string | null;
  paid_amount: number | null;
  payment_source: string | null;
  deposit_date: string | null;
  payment_entered: string | null;
  period: string | null;
  cpt_description: string | null;
  dos_from: string | null;
  dos_to: string | null;
  patient_name: string | null;
  member_id: string | null;
};
type BilledRow = {
  facility_id: string | null;
  claim_id: string | null;
  total_amount: number | null;
  period: string | null;
  entered_date: string | null;
  loc_units: Record<string, number> | null;
  patient_name: string | null;
};
type NegRow = {
  facility_id: string | null;
  negotiated_amount: number | null;
  status: string | null;
  date_signed: string | null;
};

export interface FacilityRecap {
  facilityId: string;
  name: string;
  monthLabel: string;
  priorMonthLabel: string;
  dayRange: string; // e.g. "1–17" — the same day window both months are compared over
  totalAR: number;
  expectedRevenue: number;
  collectedThisMonth: number;
  billedThisMonth: number;
  billedLastMonth: number;
  billedDelta: number;
  billedPct: number | null;
  // PHP/IOP/OP sessions this month vs last, from billed CPT units.
  locRows: { loc: string; cur: number; prior: number; delta: number }[];
  billingNote: string; // accurate, data-only; "" when nothing to compare
  riskAR: number;
  arRows: [string, number][];
  payRows: [string, number][];
  negOpen: number;
  negExpected: number;
  negDueSoon: number;
  approvedNegCount: number;
  outlook: FacilityOutlook | null;
  // Current census week + the week before it, for a "this week vs last week"
  // missed-GN comparison in the recap.
  census: { current: CensusWeekSummary | null; prior: CensusWeekSummary | null } | null;
  // Per-patient breakdown of this week's missed groups (name + why), so the
  // recap can name who was short and the reason.
  missedGroups: MissedGroupRow[];
  // Current census patients (PHP/IOP) whose most-recent payment pays less per day
  // than the management-set floor for that level of care.
  belowFloor: BelowFloorRow[];
  // Current census patients joined to their outstanding AR: per-day reimbursement
  // (from their payments) × count of outstanding claim lines = expected revenue.
  censusReceivables: CensusReceivableRow[];
  // AR bucketed by payer + status (e.g. "Horizon · Claim At"): claim count,
  // total balance, and the last date any claim in the bucket was worked.
  statusBuckets: StatusBucket[];
  // Work coverage: of all the facility's active claims, how many were worked in
  // the last 14 days.
  workCoverage: { total: number; worked14: number };
}

type LocFamily = "PHP" | "IOP" | "OP";

export interface BelowFloorRow {
  patient: string;
  loc: LocFamily;
  perDay: number; // most-recent paid ÷ days
  floor: number; // the threshold it fell under
}

export interface CensusReceivableRow {
  patient: string;
  loc: LocFamily;
  perDay: number; // expected reimbursement per day, from this patient's payments
  outstanding: number; // count of their outstanding (unpaid) AR claim lines
  expected: number; // perDay × outstanding
}

export interface ReimbursementFloors {
  PHP: number | null;
  IOP: number | null;
  OP: number | null;
}

// Level of care of a census row / a payment's CPT, reduced to PHP / IOP / OP.
// Order matters: IOP is checked before OP so "IOP" never falls through to OP.
function locFamily2(loc: unknown): LocFamily | null {
  const u = String(loc ?? "").toUpperCase();
  if (/\bIOP\b/.test(u) || /H0015|S9480/.test(u)) return "IOP";
  if (/\bPHP\b/.test(u) || /PARTIAL/.test(u) || /S0201|H0035/.test(u)) return "PHP";
  if (/\bOP\b/.test(u) || /OUTPATIENT/.test(u) || /90853/.test(u)) return "OP";
  return null;
}
// Billing CPT codes that define each level of care (for the historical per-day
// lookup): S0201/H0035 = PHP, H0015/S9480 = IOP, 90853 = OP.
const LOC_CPTS: Record<LocFamily, string[]> = {
  PHP: ["S0201", "H0035"],
  IOP: ["H0015", "S9480"],
  OP: ["90853"],
};

// Historical paid-per-day by member-ID prefix + level of care. Keyed
// "PREFIX|FAM" → the highest paid_per_day seen for that prefix's LOC codes, so a
// census patient with no payment yet still gets an expected rate off their plan.
function buildHistPerDay(rows: HistRow[]): Map<string, number> {
  const cptToFam = new Map<string, LocFamily>();
  for (const fam of Object.keys(LOC_CPTS) as LocFamily[])
    for (const cpt of LOC_CPTS[fam]) cptToFam.set(cpt, fam);
  const out = new Map<string, number>();
  for (const h of rows) {
    const prefix = String(h.prefix ?? "").trim().toUpperCase();
    const code = String(h.cpt_code || h.code_used || "").trim().toUpperCase();
    const perDay = h.paid_per_day ?? 0;
    if (!prefix || perDay <= 0) continue;
    const fam = cptToFam.get(code);
    if (!fam) continue;
    const key = `${prefix}|${fam}`;
    out.set(key, Math.max(out.get(key) ?? 0, Math.round(perDay)));
  }
  return out;
}

// From the billed report, the set of claim_ids known to be level-of-care
// (PHP/IOP/OP) services, and the set billed AT ALL. Lets the receivables count
// keep only real PHP/IOP/OP claim lines wherever billed data covers a patient.
function buildBilledClaimSets(rows: BilledRow[]): {
  loc: Set<string>;
  any: Set<string>;
} {
  const loc = new Set<string>();
  const any = new Set<string>();
  for (const b of rows) {
    const id = String(b.claim_id ?? "").trim();
    if (!id) continue;
    any.add(id);
    const lu = b.loc_units;
    if (lu && (["PHP", "IOP", "OP"] as const).some((k) => (lu[k] ?? 0) > 0)) loc.add(id);
  }
  return { loc, any };
}

// Normalize a name so "Doe, Jane" and "Jane Doe" match.
function normName(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}
function inclusiveDays(from: unknown, to: unknown): number {
  const a = Date.parse(String(from ?? ""));
  const b = Date.parse(String(to ?? ""));
  if (isNaN(a)) return 1;
  if (isNaN(b) || b < a) return 1;
  return Math.round((b - a) / 86400000) + 1;
}
const payDate = (p: PayRow): number =>
  Date.parse(String(p.deposit_date || p.payment_entered || p.dos_from || "")) || 0;

// A census patient's per-day reimbursement for a level of care, from their
// actual SERVICE payments (CPT maps to this LOC). Returns the most-recent
// MATERIAL payment's per-day — trivial secondary/adjustment postings (a $2
// remittance, a small copay) are dropped, so they can't masquerade as the rate.
// "Material" = at least 10% of the patient's best realized per-day for this LOC.
// 0 when the patient has no service payment for this level of care.
function patientPerDay(
  payments: PayRow[],
  memberId: string,
  name: string,
  fam: LocFamily
): number {
  const cands: { perDay: number; date: number }[] = [];
  for (const p of payments) {
    if ((p.paid_amount ?? 0) <= 0) continue;
    if (locFamily2(p.cpt_description) !== fam) continue;
    const pid = String(p.member_id ?? "").trim().toLowerCase();
    const match = memberId && pid ? memberId === pid : name !== "" && normName(p.patient_name) === name;
    if (!match) continue;
    const days = inclusiveDays(p.dos_from, p.dos_to);
    cands.push({ perDay: Math.round((p.paid_amount ?? 0) / (days > 0 ? days : 1)), date: payDate(p) });
  }
  if (cands.length === 0) return 0;
  const maxPD = Math.max(...cands.map((c) => c.perDay));
  const material = cands.filter((c) => c.perDay >= maxPD * 0.1);
  material.sort((a, b) => b.date - a.date);
  return material[0]?.perDay ?? maxPD;
}

// For one facility: the CURRENT CENSUS patients (latest census week) in
// PHP/IOP/OP whose most recent payment for that level of care comes in under the
// floor. Census-driven — only patients currently on the census are considered
// (no day-window on payments).
export function computeBelowFloor(
  facilityId: string,
  payments: PayRow[],
  census: {
    facility_id: string | null;
    level_of_care: string | null;
    week_start: string | null;
    patient_name: string | null;
    member_id: string | null;
  }[],
  floors: ReimbursementFloors
): BelowFloorRow[] {
  if (floors.PHP == null && floors.IOP == null && floors.OP == null) return [];
  const fCensus = census.filter((c) => c.facility_id === facilityId && c.week_start);
  if (fCensus.length === 0) return [];
  const latestWeek = fCensus.map((c) => c.week_start!).sort().slice(-1)[0];
  const current = fCensus.filter((c) => c.week_start === latestWeek);
  const fPays = payments.filter((p) => p.facility_id === facilityId);

  const out: BelowFloorRow[] = [];
  const seen = new Set<string>();
  for (const c of current) {
    const fam = locFamily2(c.level_of_care);
    if (!fam) continue;
    const floor = floors[fam];
    if (floor == null || floor <= 0) continue;

    const cid = String(c.member_id ?? "").trim().toLowerCase();
    const cnm = normName(c.patient_name);
    const dedupe = `${cid || cnm}|${fam}`;
    if (seen.has(dedupe)) continue;

    const perDay = patientPerDay(fPays, cid, cnm, fam);
    if (perDay > 0 && perDay < floor) {
      out.push({ patient: String(c.patient_name ?? "").trim() || "—", loc: fam, perDay, floor });
      seen.add(dedupe);
    }
  }
  out.sort((a, b) => a.perDay - b.perDay);
  return out;
}

// For one facility: each CURRENT CENSUS patient, joined to their outstanding AR.
// perDay = their most-recent reimbursement ÷ days of service (the payment info we
// receive on the census patient); outstanding = how many of their claim lines
// still carry a balance; expected = perDay × outstanding. Mirrors the user's
// combined line: "Sierra Peters · IOP · $114/day · 20 outstanding · $2,280".
function computeCensusReceivables(
  facilityId: string,
  payments: PayRow[],
  census: {
    facility_id: string | null;
    level_of_care: string | null;
    week_start: string | null;
    patient_name: string | null;
    member_id: string | null;
  }[],
  claims: ClaimRow[],
  histPerDay: Map<string, number>,
  billedClaims: { loc: Set<string>; any: Set<string> }
): CensusReceivableRow[] {
  const fCensus = census.filter((c) => c.facility_id === facilityId && c.week_start);
  if (fCensus.length === 0) return [];
  const latestWeek = fCensus.map((c) => c.week_start!).sort().slice(-1)[0];
  const current = fCensus.filter((c) => c.week_start === latestWeek);
  const fPays = payments.filter((p) => p.facility_id === facilityId);
  // Outstanding = still owed (a positive balance). Stale/excluded claims are
  // already filtered out of `claims` upstream, so they don't inflate the count.
  const fClaims = claims.filter((c) => c.facility_id === facilityId && (c.balance ?? 0) > 0);

  const out: CensusReceivableRow[] = [];
  const seen = new Set<string>();
  for (const c of current) {
    const fam = locFamily2(c.level_of_care);
    if (!fam) continue;
    const cid = String(c.member_id ?? "").trim().toLowerCase();
    const cnm = normName(c.patient_name);
    if (!cid && !cnm) continue;
    const dedupe = cid || cnm;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    // Per-day reimbursement from this patient's actual SERVICE payments for this
    // level of care (identical rule to the below-floor calc, so the two sections
    // agree). Falls back to the historical paid-per-day for their member-ID
    // prefix + LOC when they have no service payment on file yet.
    let perDay = patientPerDay(fPays, cid, cnm, fam);
    if (perDay <= 0) {
      const prefix = String(c.member_id ?? "").trim().slice(0, 3).toUpperCase();
      perDay = prefix ? histPerDay.get(`${prefix}|${fam}`) ?? 0 : 0;
    }
    if (perDay <= 0) continue; // no rate anywhere → can't state expected revenue

    // This patient's outstanding AR claim lines (member id first, else name).
    const theirClaims = fClaims.filter((cl) => {
      const clid = String(cl.member_id ?? "").trim().toLowerCase();
      if (cid && clid) return cid === clid;
      return cnm !== "" && normName(cl.patient_name) === cnm;
    });
    // Keep only PHP/IOP/OP claim lines. Where the billed report covers this
    // patient we trust it (only claims it marks as a level-of-care service
    // count); where it doesn't cover them at all, we can't classify, so we fall
    // back to their full outstanding set rather than drop them.
    const coveredByBilled = theirClaims.some((cl) => billedClaims.any.has(String(cl.claim_id ?? "")));
    const outstanding = coveredByBilled
      ? theirClaims.filter((cl) => billedClaims.loc.has(String(cl.claim_id ?? ""))).length
      : theirClaims.length;
    if (outstanding <= 0) continue;

    out.push({
      patient: String(c.patient_name ?? "").trim() || "—",
      loc: fam,
      perDay,
      outstanding,
      expected: perDay * outstanding,
    });
  }
  out.sort((a, b) => b.expected - a.expected);
  return out;
}

// Pull the payer out of a claim status like "Claim at BCBS" / "Denied at Aetna".
function payerFromStatus(status: unknown): string {
  const t = String(status ?? "").trim();
  if (!t) return "Unassigned";
  const m = t.match(/\bat\s+(.+)$/i);
  if (!m) return "Other";
  const p = m[1].split(/\s{2,}|[|,;]/)[0].trim();
  return p ? p.toUpperCase() : "Other";
}

function parseDate(v: unknown): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const t = Date.parse(s);
  return isNaN(t) ? null : new Date(t);
}
// Build a recap per facility (mirrors the /facility dashboard). Pass facilityIds
// to scope to specific facilities (e.g. a facility login's own).
export async function computeFacilityRecaps(
  client: Admin,
  opts?: { facilityIds?: string[]; now?: Date }
): Promise<FacilityRecap[]> {
  const now = opts?.now ?? new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthLabel = now.toLocaleString("en-US", { month: "long", year: "numeric" });
  const prior = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const priorKey = `${prior.getFullYear()}-${String(prior.getMonth() + 1).padStart(2, "0")}`;
  const priorMonthLabel = prior.toLocaleString("en-US", { month: "long", year: "numeric" });
  // Month-over-month is APPLES-TO-APPLES: the current month is only partway
  // through, so we compare each month only through the SAME day-of-month. On
  // Aug 17 that's Aug 1–17 vs Jul 1–17; on Aug 23 it's Jul/Aug 1–23. Otherwise a
  // full prior month makes the in-progress month always look way down.
  const cutoffDay = now.getDate();
  const dayRange = `1–${cutoffDay}`;
  // True when a date falls in `target`'s month AND on/before the cutoff day.
  const inWindow = (v: unknown, target: Date): boolean => {
    const d = parseDate(v);
    return (
      !!d &&
      d.getFullYear() === target.getFullYear() &&
      d.getMonth() === target.getMonth() &&
      d.getDate() <= cutoffDay
    );
  };
  const only = opts?.facilityIds && opts.facilityIds.length ? new Set(opts.facilityIds) : null;
  const scopeIn = (q: any) => (only ? q.in("facility_id", Array.from(only)) : q);

  const [
    facilitiesAll,
    claimsRaw,
    payments,
    billed,
    negs,
    auths,
    census,
    repricing,
    historical,
    claimWork,
  ] = await Promise.all([
      pageAll<{ id: string; name: string; short_name: string | null }>(client, (a) =>
        a.from("facilities").select("id,name,short_name").order("name")
      ),
      pageAll<ClaimRow>(client, (a) =>
        scopeIn(
          a
            .from("claims")
            .select("facility_id,claim_id,member_id,patient_name,balance,age_days,claim_status")
            .eq("present", true)
        )
      ),
      pageAll<PayRow>(client, (a) =>
        scopeIn(
          a
            .from("payments")
            .select(
              "facility_id,paid_amount,payment_source,deposit_date,payment_entered,period,cpt_description,dos_from,dos_to,patient_name,member_id"
            )
        )
      ).catch(() => []),
      pageAll<BilledRow>(client, (a) =>
        scopeIn(
          a
            .from("billed_claims")
            .select("facility_id,claim_id,total_amount,period,entered_date,loc_units,patient_name")
        )
      ).catch(() => []),
      pageAll<NegRow>(client, (a) =>
        scopeIn(a.from("negotiations").select("facility_id,negotiated_amount,status,date_signed"))
      ).catch(() => []),
      pageAll<any>(client, (a) =>
        scopeIn(
          a
            .from("authorizations")
            .select("facility_id,discharged,discharge_date,next_review_date,created_at")
        )
      ).catch(() => []),
      pageAll<any>(client, (a) =>
        scopeIn(
          a
            .from("census")
            .select("facility_id,level_of_care,week_start,gn_rate,patient_name,days,member_id,admit_date")
        )
      ).catch(() => []),
      pageAll<any>(client, (a) =>
        scopeIn(a.from("repricing").select("facility_id,total_amount,amount_paid,claim_status"))
      ).catch(() => []),
      // Historical reimbursement reference (global — not facility-scoped): the
      // per-day paid rate by member-ID prefix + service code, used as the
      // per-day fallback when a census patient has no payment on file yet.
      pageAll<HistRow>(client, (a) =>
        a.from("historical_data").select("prefix,cpt_code,code_used,paid_per_day")
      ).catch(() => []),
      // Last-worked dates for the status buckets (claim_id → date_worked).
      pageAll<{ claim_id: string | null; date_worked: string | null }>(client, (a) =>
        a.from("claim_work").select("claim_id,date_worked")
      ).catch(() => []),
    ]);

  const facilities = only ? facilitiesAll.filter((f) => only.has(f.id)) : facilitiesAll;
  const claims = claimsRaw.filter(
    (c) => !isExcludedMember(c.member_id) && !isStaleClaim(c.age_days)
  );
  // Per-day rate fallback + PHP/IOP/OP claim classification, built once.
  const histPerDay = buildHistPerDay(historical as HistRow[]);
  const billedClaimSets = buildBilledClaimSets(billed as BilledRow[]);
  // claim_id → last date_worked, for the status buckets' "last worked" column.
  const workedByClaim = new Map<string, string>();
  for (const w of claimWork as { claim_id: string | null; date_worked: string | null }[]) {
    if (w.claim_id && w.date_worked) workedByClaim.set(w.claim_id, w.date_worked);
  }

  // Per-facility reimbursement floors. These columns are optional — if the
  // migration hasn't been run yet the query errors, and we treat every floor as
  // unset (the below-floor section just doesn't appear). Crucially this must NOT
  // take the whole recap down, so it's fetched separately from the facility list.
  const floorsByFac = new Map<string, ReimbursementFloors>();
  {
    const pos = (n: number | null | undefined) => (n != null && n > 0 ? n : null);
    const { data: floorRows, error: floorErr } = await client
      .from("facilities")
      .select("id,php_floor,iop_floor,op_floor");
    if (!floorErr) {
      for (const r of (floorRows ?? []) as {
        id: string;
        php_floor: number | null;
        iop_floor: number | null;
        op_floor: number | null;
      }[]) {
        floorsByFac.set(r.id, { PHP: pos(r.php_floor), IOP: pos(r.iop_floor), OP: pos(r.op_floor) });
      }
    }
  }

  const outlooks = computeOutlooks({
    facilities: facilities.map((f) => ({ id: f.id, name: f.name, short_name: f.short_name })),
    payments,
    billed: billed.map((b) => ({
      facility_id: b.facility_id,
      total_amount: b.total_amount,
      period: b.period,
      loc_units: b.loc_units,
      patient_name: b.patient_name,
    })),
    claims: claims.map((c) => ({ facility_id: c.facility_id, balance: c.balance, age_days: c.age_days })),
    auths,
    census,
    repricing,
  });
  const outlookOf = new Map(outlooks.filter((o) => o.facility_id).map((o) => [o.facility_id, o]));

  const today0 = new Date(now);
  today0.setHours(0, 0, 0, 0);
  const soon = new Date(today0.getTime() + NEG_PAY_LAG_DAYS * 86400000);
  // Claims worked on/after this moment count toward the 14-day work coverage.
  const worked14Cutoff = today0.getTime() - 14 * 86400000;

  return facilities.map((f) => {
    const fc = claims.filter((c) => c.facility_id === f.id);
    const totalAR = fc.reduce((s, c) => s + (c.balance ?? 0), 0);

    const arByPayer = new Map<string, number>();
    for (const c of fc) {
      const bal = c.balance ?? 0;
      if (bal <= 0) continue;
      const p = payerFromStatus(c.claim_status);
      arByPayer.set(p, (arByPayer.get(p) ?? 0) + bal);
    }
    const riskAR = fc.reduce((s, c) => s + (isRiskPayer(c.claim_status) ? c.balance ?? 0 : 0), 0);

    // Payments collected in the current month THROUGH the cutoff day.
    const monthPays = payments.filter(
      (p) =>
        p.facility_id === f.id &&
        (inWindow(p.deposit_date, now) || inWindow(p.payment_entered, now))
    );
    const collectedThisMonth = monthPays.reduce((s, p) => s + (p.paid_amount ?? 0), 0);
    const payByPayer = new Map<string, number>();
    for (const p of monthPays) {
      const src = (p.payment_source || "Other").toUpperCase();
      payByPayer.set(src, (payByPayer.get(src) ?? 0) + (p.paid_amount ?? 0));
    }

    // Billed rows in `target`'s month, capped at the cutoff day. Day comes from
    // the billing date (entered/from); a row with no date at all falls back to
    // its period tag so it isn't dropped (can't day-cap those).
    const billedInMonth = (key: string, target: Date) =>
      billed.filter((b) => {
        if (b.facility_id !== f.id) return false;
        const d = parseDate(b.entered_date);
        if (d)
          return (
            d.getFullYear() === target.getFullYear() &&
            d.getMonth() === target.getMonth() &&
            d.getDate() <= cutoffDay
          );
        return b.period === key;
      });
    const billedThisMonth = billedInMonth(monthKey, now).reduce((s, b) => s + (b.total_amount ?? 0), 0);
    const billedLastMonth = billedInMonth(priorKey, prior).reduce((s, b) => s + (b.total_amount ?? 0), 0);

    // Level-of-care sessions billed each month (through the cutoff day), from the
    // billed CPT units — the accurate "why" behind a billing swing.
    const locSessions = (key: string, target: Date) => {
      const acc: Record<string, number> = {};
      for (const b of billedInMonth(key, target)) {
        if (!b.loc_units) continue;
        for (const [fam, u] of Object.entries(b.loc_units)) acc[fam] = (acc[fam] ?? 0) + (Number(u) || 0);
      }
      return acc;
    };
    const curLoc = locSessions(monthKey, now);
    const priorLoc = locSessions(priorKey, prior);
    const LOC_ORDER = ["PHP", "IOP", "OP"];
    const locKeys = [
      ...LOC_ORDER.filter((x) => x in curLoc || x in priorLoc),
      ...Object.keys({ ...curLoc, ...priorLoc }).filter((x) => !LOC_ORDER.includes(x)),
    ];
    const locRows = locKeys.map((loc) => ({
      loc,
      cur: curLoc[loc] ?? 0,
      prior: priorLoc[loc] ?? 0,
      delta: (curLoc[loc] ?? 0) - (priorLoc[loc] ?? 0),
    }));

    // Accurate, data-only trend note (no generic/guessed text).
    const billedDelta = billedThisMonth - billedLastMonth;
    const billedPct = billedLastMonth > 0 ? Math.round((billedDelta / billedLastMonth) * 100) : null;
    let billingNote = "";
    if (billedThisMonth > 0 || billedLastMonth > 0) {
      if (billedLastMonth <= 0) {
        billingNote = `No billing on file for ${priorMonthLabel} to compare against.`;
      } else if (billedDelta === 0) {
        billingNote = `Billing is unchanged from ${priorMonthLabel}.`;
      } else {
        const dir = billedDelta < 0 ? "down" : "up";
        const movers = locRows
          .filter((r) => (billedDelta < 0 ? r.delta < 0 : r.delta > 0))
          .sort((a, b) => (billedDelta < 0 ? a.delta - b.delta : b.delta - a.delta));
        const top = movers[0];
        const stem = `Through the same days (${dayRange}), billing is ${dir} ${money(
          Math.abs(billedDelta)
        )} (${Math.abs(billedPct ?? 0)}%) vs ${priorMonthLabel}.`;
        billingNote = top
          ? `${stem} Biggest driver: ${top.loc} sessions ${top.cur} vs ${top.prior} (${
              top.delta > 0 ? "+" : ""
            }${top.delta}).`
          : stem;
      }
    }

    const approved = negs.filter(
      (n) => n.facility_id === f.id && /approv|signed/i.test(n.status || "")
    );
    let negOpen = 0;
    let negExpected = 0;
    let negDueSoon = 0;
    for (const n of approved) {
      const signed = parseDate(n.date_signed);
      const payBy = signed ? new Date(signed.getTime() + NEG_PAY_LAG_DAYS * 86400000) : null;
      if (payBy && payBy < today0) continue; // already landed
      negOpen++;
      negExpected += n.negotiated_amount ?? 0;
      if (payBy && payBy >= today0 && payBy <= soon) negDueSoon += n.negotiated_amount ?? 0;
    }

    return {
      facilityId: f.id,
      name: f.short_name || f.name,
      monthLabel,
      priorMonthLabel,
      dayRange,
      totalAR,
      expectedRevenue: totalAR * EXPECTED_RATE,
      collectedThisMonth,
      billedThisMonth,
      billedLastMonth,
      billedDelta,
      billedPct,
      locRows,
      billingNote,
      riskAR,
      arRows: Array.from(arByPayer.entries()).sort((a, b) => b[1] - a[1]),
      payRows: Array.from(payByPayer.entries())
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]),
      negOpen,
      negExpected,
      negDueSoon,
      approvedNegCount: approved.length,
      outlook: outlookOf.get(f.id) ?? null,
      census: (() => {
        const c = facilityCensusCompare(f.id, census);
        return c.current ? c : null;
      })(),
      missedGroups: missedGroupDetail(f.id, census).rows,
      belowFloor: computeBelowFloor(
        f.id,
        payments,
        census,
        floorsByFac.get(f.id) ?? { PHP: null, IOP: null, OP: null }
      ),
      censusReceivables: computeCensusReceivables(
        f.id,
        payments,
        census,
        fc,
        histPerDay,
        billedClaimSets
      ),
      statusBuckets: bucketByStatus(fc, workedByClaim),
      workCoverage: {
        total: fc.length,
        worked14: fc.filter((c) => {
          const dw = c.claim_id ? workedByClaim.get(c.claim_id) : null;
          if (!dw) return false;
          const t = Date.parse(dw);
          return !isNaN(t) && t >= worked14Cutoff;
        }).length,
      },
    };
  });
}

// Facility id → its login email(s): profiles with role='facility' whose primary
// facility_id matches, or who are granted the facility via assignments. Emails
// via getUserById (direct, most reliable). NEEDS the service-role client.
export async function facilityRecipients(admin: Admin): Promise<Map<string, string[]>> {
  const [{ data: profsRaw }, { data: asgs }] = await Promise.all([
    admin.from("profiles").select("id,facility_id,receives_daily_emails").eq("role", "facility"),
    admin.from("assignments").select("profile_id,facility_id"),
  ]);
  // Exclude facility logins toggled off in Admin (receives_daily_emails = false).
  const profs = (profsRaw ?? []).filter(
    (p: { receives_daily_emails: boolean | null }) => p.receives_daily_emails !== false
  );
  const profileIds = new Set((profs ?? []).map((p: { id: string }) => p.id));

  const emailOf = new Map<string, string>();
  for (const p of (profs ?? []) as { id: string }[]) {
    try {
      const { data } = await admin.auth.admin.getUserById(p.id);
      if (data?.user?.email) emailOf.set(p.id, data.user.email);
    } catch {
      /* skip */
    }
  }

  const facToProfiles = new Map<string, Set<string>>();
  const add = (fid: string | null, pid: string) => {
    if (!fid) return;
    if (!facToProfiles.has(fid)) facToProfiles.set(fid, new Set());
    facToProfiles.get(fid)!.add(pid);
  };
  for (const p of (profs ?? []) as { id: string; facility_id: string | null }[])
    add(p.facility_id, p.id);
  for (const a of (asgs ?? []) as { profile_id: string; facility_id: string | null }[])
    if (profileIds.has(a.profile_id)) add(a.facility_id, a.profile_id);

  const out = new Map<string, string[]>();
  for (const [fid, pids] of facToProfiles) {
    const emails = Array.from(pids)
      .map((pid) => emailOf.get(pid))
      .filter((e): e is string => !!e);
    if (emails.length) out.set(fid, Array.from(new Set(emails)));
  }
  return out;
}

// Per-facility extra BCC for the daily recap (facilities.recap_bcc, a comma-
// separated address list). Fetched on its own and error-tolerant, so a missing
// column (migration not yet applied) never breaks the recap send.
export async function recapBccByFacility(
  admin: Admin
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  try {
    const { data } = await admin.from("facilities").select("id,recap_bcc");
    for (const f of (data ?? []) as { id: string; recap_bcc: string | null }[]) {
      const emails = String(f.recap_bcc ?? "")
        .split(/[,;\s]+/)
        .map((e) => e.trim())
        .filter((e) => e.includes("@"));
      if (emails.length) out.set(f.id, Array.from(new Set(emails)));
    }
  } catch {
    /* column not migrated yet — no extra BCCs */
  }
  return out;
}

// ---- HTML rendering -------------------------------------------------------
// Navy "brief" look, matched to the monthly reporting & invoice email: Arial,
// navy headings/section rules, green for dollars, red only for risk. No boxes —
// each section is a label + a thin navy rule + the content beneath it.

const NAVY = "#1b3a5b"; // headings, section labels, rules — matches the brand
const INK = "#222"; // body text (same as the monthly invoice email)
const MUTE = "#555";
const FAINT = "#888";
const POS = "#137333"; // green for money collected (same as invoice "Amount Due")
const NEG = "#b00020"; // red for risk / drops
const HAIR = "#eee"; // thin row rules
const NUM = "font-variant-numeric:tabular-nums";

// A key figure: small uppercase label above a large value. No border/box.
function statTile(label: string, value: string, color: string, sub?: string): string {
  return `<td style="padding:0 16px 0 0;vertical-align:top;width:25%">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:${MUTE}">${label}</div>
    <div style="font-size:22px;font-weight:700;color:${color};margin-top:4px;${NUM}">${value}</div>
    ${sub ? `<div style="font-size:11px;color:${FAINT};margin-top:2px">${sub}</div>` : ""}
  </td>`;
}

// A boxless section header: a thin navy rule with an uppercase navy label.
function sectionHead(title: string): string {
  return `<div style="border-top:1px solid ${NAVY};margin:26px 0 0"></div>
    <div style="font-weight:700;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${NAVY};padding:9px 0 12px">${title}</div>`;
}

function breakdown(title: string, total: number, rows: [string, number][], accent: string, empty: string): string {
  const body = rows
    .map(([label, val]) => {
      const pct = total > 0 ? Math.round((val / total) * 100) : 0;
      const risk = isRiskPayer(label);
      return `<tr>
        <td style="padding:8px 0;border-bottom:1px solid ${HAIR};color:${risk ? NEG : INK}">${label}${risk ? " ⚠" : ""}</td>
        <td style="padding:8px 0;border-bottom:1px solid ${HAIR};text-align:right;font-weight:600;color:${accent};${NUM}">${money(val)}</td>
        <td style="padding:8px 0;border-bottom:1px solid ${HAIR};text-align:right;color:${FAINT};width:46px;font-size:12px;${NUM}">${pct}%</td>
      </tr>`;
    })
    .join("");
  return `${sectionHead(`${title} — ${money(total)}`)}
    ${
      rows.length
        ? `<table style="border-collapse:collapse;width:100%;font-size:13px"><tbody>${body}</tbody></table>`
        : `<p style="color:${FAINT};margin:0">${empty}</p>`
    }`;
}

export function renderFacilityRecap(r: FacilityRecap, date: string): string {
  const nice = new Date(date + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  // Money Outlook — one plain-English, forward-looking sentence (no RCM jargon,
  // no aging/auth/repricing internals, no misleading month-to-date percentages).
  // Insurers pay ~a month after a claim is billed, so this month's billing trend
  // previews next month's collections. Leads with the biggest level-of-care mover.
  const topMover = (() => {
    const want = r.billedDelta < 0 ? -1 : 1;
    const movers = r.locRows
      .filter((l) => Math.sign(l.delta) === want && l.delta !== 0)
      .sort((a, b) => (want < 0 ? a.delta - b.delta : b.delta - a.delta));
    const t = movers[0];
    return t ? ` — led by ${t.loc} sessions (${t.cur} vs ${t.prior} last month)` : "";
  })();
  const collectedSoFar = `You've collected ${money(r.collectedThisMonth)} so far in ${r.monthLabel}.`;
  let ahead: string;
  if (r.billedThisMonth <= 0 && r.billedLastMonth <= 0) {
    ahead = collectedSoFar;
  } else if (r.billedDelta > 0) {
    ahead = `${collectedSoFar} Billing is running ahead of ${r.priorMonthLabel}${topMover}, so collections should pick up over the next month or so as those claims get paid.`;
  } else if (r.billedDelta < 0) {
    ahead = `${collectedSoFar} Billing is running behind ${r.priorMonthLabel}${topMover}, so collections may be a little lighter over the next month or so.`;
  } else {
    ahead = `${collectedSoFar} Billing is about the same as ${r.priorMonthLabel}, so collections should hold steady over the next month or so.`;
  }

  // "Billing vs last month" — accurate, data-only (no generic text).
  const billLocRows = r.locRows
    .map((l) => {
      const c = l.delta < 0 ? NEG : l.delta > 0 ? POS : FAINT;
      return `<tr>
        <td style="padding:7px 0;border-bottom:1px solid ${HAIR}">${l.loc}</td>
        <td style="padding:7px 0;border-bottom:1px solid ${HAIR};text-align:right;${NUM}">${l.cur}</td>
        <td style="padding:7px 0;border-bottom:1px solid ${HAIR};text-align:right;color:${FAINT};${NUM}">${l.prior}</td>
        <td style="padding:7px 0;border-bottom:1px solid ${HAIR};text-align:right;color:${c};font-weight:600;${NUM}">${l.delta > 0 ? "+" : ""}${l.delta}</td>
      </tr>`;
    })
    .join("");
  const billingBlock =
    r.billedThisMonth > 0 || r.billedLastMonth > 0
      ? `${sectionHead(`Billing vs last month · same days (${r.dayRange})`)}
          <table style="border-collapse:collapse;width:100%;margin-bottom:2px"><tr>
            ${statTile(`Billed · ${r.monthLabel} (${r.dayRange})`, money(r.billedThisMonth), INK)}
            ${statTile(`Billed · ${r.priorMonthLabel} (${r.dayRange})`, money(r.billedLastMonth), INK)}
            ${statTile(
              "Change",
              `${r.billedDelta < 0 ? "−" : "+"}${money(Math.abs(r.billedDelta))}`,
              r.billedDelta < 0 ? NEG : POS,
              r.billedPct != null ? `${r.billedPct > 0 ? "+" : ""}${r.billedPct}%` : undefined
            )}
            <td style="width:25%"></td>
          </tr></table>
          ${
            billLocRows
              ? `<table style="border-collapse:collapse;width:100%;font-size:13px;margin-top:12px">
                  <thead><tr style="text-align:left;color:${FAINT};font-size:11px;text-transform:uppercase;letter-spacing:.05em">
                    <th style="padding:4px 0">Level of care</th>
                    <th style="padding:4px 0;text-align:right">Sessions · ${r.monthLabel} (${r.dayRange})</th>
                    <th style="padding:4px 0;text-align:right">Sessions · ${r.priorMonthLabel} (${r.dayRange})</th>
                    <th style="padding:4px 0;text-align:right">Change</th>
                  </tr></thead><tbody>${billLocRows}</tbody></table>`
              : ""
          }
          ${r.billingNote ? `<div style="margin-top:10px;color:${INK}">${r.billingNote}</div>` : ""}`
      : "";

  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:${INK};line-height:1.6;background:#fff;padding:30px 28px 24px">
    <div style="font-weight:700;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:${NAVY}">BC Billing</div>
    <div style="font-size:26px;font-weight:800;color:${NAVY};margin:8px 0 2px;letter-spacing:-.01em">${r.name}</div>
    <div style="color:${MUTE};border-bottom:2px solid ${NAVY};padding-bottom:14px">Daily Recap — ${nice}</div>

    <table style="border-collapse:collapse;width:100%;margin-top:20px">
      <tr>
        ${statTile("Total AR (Outstanding)", money(r.totalAR), NAVY)}
        ${statTile("Expected Revenue", money(r.expectedRevenue), NAVY, `${Math.round(EXPECTED_RATE * 100)}% of AR`)}
        ${statTile(`Collected · ${r.monthLabel}`, money(r.collectedThisMonth), POS)}
        ${statTile(`Billed · ${r.monthLabel}`, money(r.billedThisMonth), INK)}
      </tr>
    </table>

    ${billingBlock}

    ${sectionHead("Money Outlook")}
    <div style="color:${INK}">${ahead}</div>

    ${
      r.statusBuckets.length
        ? `${sectionHead("AR by status")}
            <table style="border-collapse:collapse;width:100%;font-size:13px">
              <thead><tr style="text-align:left;color:${FAINT};font-size:11px;text-transform:uppercase;letter-spacing:.05em">
                <th style="padding:4px 0">Status</th>
                <th style="padding:4px 0;text-align:right">Claims</th>
                <th style="padding:4px 0;text-align:right">Balance</th>
              </tr></thead>
              <tbody>
                ${r.statusBuckets
                  .map(
                    (b) => `<tr>
                      <td style="padding:7px 0;border-bottom:1px solid ${HAIR};font-weight:600;color:${INK}">${b.label}</td>
                      <td style="padding:7px 0;border-bottom:1px solid ${HAIR};text-align:right;${NUM}">${b.count}</td>
                      <td style="padding:7px 0;border-bottom:1px solid ${HAIR};text-align:right;font-weight:700;color:${NAVY};${NUM}">${money(b.balance)}</td>
                    </tr>`
                  )
                  .join("")}
              </tbody>
            </table>`
        : ""
    }

    ${
      r.census && r.census.current
        ? (() => {
            const cur = r.census.current;
            const pri = r.census.prior;
            // Missed-GN change vs last week (fewer missed = good, shown green).
            let gnSub: string;
            let gnColor = cur.missedGroups > 0 ? NEG : POS;
            if (!pri) {
              gnSub = "no prior week yet";
            } else {
              const d = cur.missedGroups - pri.missedGroups;
              if (d === 0) gnSub = `same as last wk (${pri.missedGroups})`;
              else if (d > 0) gnSub = `▲ +${d} vs last wk (${pri.missedGroups})`;
              else {
                gnSub = `▼ ${d} vs last wk (${pri.missedGroups})`;
                gnColor = POS; // improved
              }
            }
            return `${sectionHead(`Census · ${cur.weekLabel} (current week)`)}
            <table style="border-collapse:collapse;width:100%"><tr>
              ${statTile("Census (Patients)", String(cur.patients), INK)}
              ${statTile("Missed Groups (GN)", String(cur.missedGroups), gnColor, gnSub)}
              ${statTile("Missed Revenue", money(cur.missedRev), cur.missedRev > 0 ? NEG : POS)}
              <td style="width:25%"></td>
            </tr></table>`;
          })()
        : ""
    }

    ${
      r.missedGroups.length
        ? `${sectionHead("Missed groups — who & why")}
            <table style="border-collapse:collapse;width:100%;font-size:13px">
              <thead><tr style="text-align:left;color:${FAINT};font-size:11px;text-transform:uppercase;letter-spacing:.05em">
                <th style="padding:4px 0">Patient</th>
                <th style="padding:4px 0">Level</th>
                <th style="padding:4px 0;text-align:center">Missed</th>
                <th style="padding:4px 0">Reason</th>
              </tr></thead>
              <tbody>
                ${r.missedGroups
                  .map(
                    (m) => `<tr>
                      <td style="padding:7px 0;border-bottom:1px solid ${HAIR};font-weight:600;color:${INK}">${m.patient}</td>
                      <td style="padding:7px 0;border-bottom:1px solid ${HAIR};color:${MUTE}">${m.loc || "—"}</td>
                      <td style="padding:7px 0;border-bottom:1px solid ${HAIR};text-align:center;font-weight:700;color:${NEG}">−${m.missed}</td>
                      <td style="padding:7px 0;border-bottom:1px solid ${HAIR};color:${MUTE}">${m.reason}</td>
                    </tr>`
                  )
                  .join("")}
              </tbody>
            </table>
            <div style="color:${FAINT};font-size:11px;margin-top:6px">Groups already held before a client's admit date aren't counted against them.</div>`
        : ""
    }

    ${
      r.censusReceivables.length
        ? `${sectionHead("Census — expected revenue on outstanding claims")}
            <table style="border-collapse:collapse;width:100%;font-size:13px">
              <thead><tr style="text-align:left;color:${FAINT};font-size:11px;text-transform:uppercase;letter-spacing:.05em">
                <th style="padding:4px 0">Patient</th>
                <th style="padding:4px 0">Level</th>
                <th style="padding:4px 0;text-align:right">Per day</th>
                <th style="padding:4px 0;text-align:right">Outstanding</th>
                <th style="padding:4px 0;text-align:right">Expected Revenue</th>
              </tr></thead>
              <tbody>
                ${r.censusReceivables
                  .map(
                    (c) => `<tr>
                      <td style="padding:7px 0;border-bottom:1px solid ${HAIR};font-weight:600;color:${INK}">${c.patient}</td>
                      <td style="padding:7px 0;border-bottom:1px solid ${HAIR};color:${MUTE}">${c.loc}</td>
                      <td style="padding:7px 0;border-bottom:1px solid ${HAIR};text-align:right;${NUM}">${money(c.perDay)}/day</td>
                      <td style="padding:7px 0;border-bottom:1px solid ${HAIR};text-align:right;${NUM}">${c.outstanding} ${c.loc}</td>
                      <td style="padding:7px 0;border-bottom:1px solid ${HAIR};text-align:right;font-weight:700;color:${POS};${NUM}">${money(c.expected)}</td>
                    </tr>`
                  )
                  .join("")}
                <tr>
                  <td colspan="4" style="padding:8px 0;text-align:right;font-weight:600;color:${MUTE}">Total expected on current census</td>
                  <td style="padding:8px 0;text-align:right;font-weight:800;color:${POS};${NUM}">${money(
                    r.censusReceivables.reduce((s, c) => s + c.expected, 0)
                  )}</td>
                </tr>
              </tbody>
            </table>
            <div style="color:${FAINT};font-size:11px;margin-top:6px">Per-day = this patient's most recent reimbursement rate; expected = per-day × their outstanding claim lines.</div>`
        : ""
    }

    ${
      r.belowFloor.length
        ? `${sectionHead("Patients below reimbursement floor")}
            <table style="border-collapse:collapse;width:100%;font-size:13px">
              <thead><tr style="text-align:left;color:${FAINT};font-size:11px;text-transform:uppercase;letter-spacing:.05em">
                <th style="padding:4px 0">Patient</th>
                <th style="padding:4px 0">Level</th>
                <th style="padding:4px 0;text-align:right">Paid / day</th>
                <th style="padding:4px 0;text-align:right">Floor</th>
              </tr></thead>
              <tbody>
                ${r.belowFloor
                  .map(
                    (b) => `<tr>
                      <td style="padding:7px 0;border-bottom:1px solid ${HAIR}">${b.patient}</td>
                      <td style="padding:7px 0;border-bottom:1px solid ${HAIR}">${b.loc}</td>
                      <td style="padding:7px 0;border-bottom:1px solid ${HAIR};text-align:right;font-weight:700;color:${NEG};${NUM}">${money(b.perDay)}</td>
                      <td style="padding:7px 0;border-bottom:1px solid ${HAIR};text-align:right;color:${FAINT};${NUM}">${money(b.floor)}</td>
                    </tr>`
                  )
                  .join("")}
              </tbody>
            </table>
            <div style="margin-top:8px;color:${MUTE};font-size:12px">Current census patients whose most recent payment for their level of care comes in under the per-day floor.</div>`
        : ""
    }

    ${
      r.riskAR > 0
        ? `${sectionHead("Risk of non-reimbursement")}
            <table style="width:100%"><tr>
              <td style="width:68%;vertical-align:top;color:#7a2b26">Marketplace / exchange plans — Highmark, Capital Blue Cross, Independence Blue Cross. Prioritize before these age out.</td>
              <td style="text-align:right;white-space:nowrap;vertical-align:top">
                <div style="font-size:22px;font-weight:700;color:${NEG};${NUM}">${money(r.riskAR)}</div>
                <div style="font-size:12px;color:${FAINT}">${r.totalAR > 0 ? Math.round((r.riskAR / r.totalAR) * 100) : 0}% of AR</div>
              </td>
            </tr></table>`
        : ""
    }

    ${breakdown("Outstanding AR by payer", r.totalAR, r.arRows, NAVY, "No outstanding balance on file.")}
    ${breakdown(`Payments collected · ${r.monthLabel} — by payer`, r.collectedThisMonth, r.payRows, POS, `No payments recorded yet for ${r.monthLabel}.`)}

    ${sectionHead("Negotiations — expected revenue")}
    ${
      r.approvedNegCount === 0
        ? `<p style="color:${FAINT};margin:0">No approved negotiations on file.</p>`
        : `<table style="border-collapse:collapse;width:100%"><tr>
            ${statTile("Awaiting payment", String(r.negOpen), INK, `${r.approvedNegCount} approved on file`)}
            ${statTile("Expected revenue", money(r.negExpected), NAVY, "not yet landed")}
            ${statTile("Landing within 14 days", money(r.negDueSoon), POS, `paid ~${NEG_PAY_LAG_DAYS} days after approval`)}
            <td style="width:25%"></td>
          </tr></table>`
    }

    <hr style="border:none;border-top:1px solid #ddd;margin-top:24px" />
    <p style="font-size:11px;color:${FAINT}">Automated daily recap from BC Billing. Contains PHI — handle per HIPAA.</p>
  </div>`;
}
