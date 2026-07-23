import { money } from "@/lib/format";
import { CENSUS_LOC_GN } from "@/lib/types";

// ---------------------------------------------------------------------------
// Money Outlook — a per-facility, month-over-month forecast that explains WHY
// revenue is improving or declining. It weighs the levers that actually move
// the money: payments trend, payer/policy mix, billed pipeline, level-of-care
// acuity (census), the authorization pipeline, collections aging, and
// repricing at stake. The output is a plain-English read, not just numbers.
// ---------------------------------------------------------------------------

export type Direction = "up" | "down" | "flat" | "risk";

export interface OutlookDriver {
  key: string;
  label: string;
  direction: Direction;
  detail: string; // plain-English explanation
  impact: number; // absolute $ influence, for ranking (0 if not dollar-based)
}

export interface FacilityOutlook {
  facility_id: string | null; // null = network rollup ("All facilities")
  facility_name: string;
  curMonth: string; // YYYY-MM
  priorMonth: string; // YYYY-MM
  curLabel: string; // e.g. "Jun 2026"
  priorLabel: string;
  paidCur: number;
  paidPrior: number;
  pct: number | null; // MoM % change in payments (null = no prior month)
  direction: Direction;
  headline: string;
  reason: string; // one-line summary of the drivers
  drivers: OutlookDriver[];
}

const EXPECTED_PCT = 0.3; // census billing estimate = GN sessions × rate × 30%
const MON = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : 0);

// A date string or a "YYYY-MM" period → its month bucket "YYYY-MM".
function monthOf(v: string | null | undefined): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{4})-(\d{2})/); // YYYY-MM or YYYY-MM-DD
  if (m) return `${m[1]}-${m[2]}`;
  const t = Date.parse(s);
  if (isNaN(t)) return "";
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function addMonth(ym: string, delta: number): string {
  const m = ym.match(/^(\d{4})-(\d{2})$/);
  if (!m) return ym;
  let y = Number(m[1]);
  let mo = Number(m[2]) - 1 + delta;
  y += Math.floor(mo / 12);
  mo = ((mo % 12) + 12) % 12;
  return `${y}-${String(mo + 1).padStart(2, "0")}`;
}

function monthLabel(ym: string): string {
  const m = ym.match(/^(\d{4})-(\d{2})$/);
  return m ? `${MON[Number(m[2]) - 1]} ${m[1]}` : ym || "—";
}

function pctChange(cur: number, prior: number): number | null {
  if (prior <= 0) return null; // no comparable prior month
  return ((cur - prior) / prior) * 100;
}

// Revenue acuity of a level of care — higher = bills more. Uses the census GN
// map where possible, else keyword rules so authorization LOCs (IOP/PHP/OP…)
// also resolve.
function locWeight(loc: string | null | undefined): number {
  const s = String(loc ?? "").trim();
  if (!s) return 0;
  if (CENSUS_LOC_GN[s] != null) return CENSUS_LOC_GN[s];
  const u = s.toUpperCase();
  if (/DETOX|WITHDRAW/.test(u)) return 7;
  if (/RESID|\bRTC\b|INPATIENT|\bIP\b/.test(u)) return 7;
  if (/PHP/.test(u)) return 6;
  if (/IOP/.test(u)) return 4;
  if (/\bOP\b|OUTPATIENT/.test(u)) return 1;
  const m = u.match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

function dayMs(v: string | null | undefined): number | null {
  const t = Date.parse(String(v ?? "").trim());
  if (isNaN(t)) return null;
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ---- input shapes (only the columns we need) ------------------------------
type FacRef = { id: string; name: string; short_name: string | null };
type PayRow = {
  facility_id: string | null;
  paid_amount: number | null;
  payment_source: string | null;
  period: string | null;
  deposit_date: string | null;
};
type BilledRow = {
  facility_id: string | null;
  total_amount: number | null;
  period: string | null;
};
type ClaimRow = { facility_id: string | null; balance: number | null; age_days: number | null };
type AuthRow = {
  facility_id: string | null;
  discharged: boolean | null;
  discharge_date: string | null;
  next_review_date: string | null;
  created_at: string | null;
};
type CensusRow = {
  facility_id: string | null;
  level_of_care: string | null;
  week_start: string | null;
  gn_rate: number | null;
};
type RepriceRow = {
  facility_id: string | null;
  total_amount: number | null;
  amount_paid: number | null;
  claim_status: string | null;
};

export interface OutlookInputs {
  facilities: FacRef[];
  payments: PayRow[];
  billed: BilledRow[];
  claims: ClaimRow[];
  auths: AuthRow[];
  census: CensusRow[];
  repricing: RepriceRow[];
}

// Build one facility's outlook (facility=null → network rollup over everything).
function buildOne(
  facility: FacRef | null,
  cur: string,
  prior: string,
  todayMs: number,
  data: OutlookInputs
): FacilityOutlook {
  const fid = facility?.id ?? null;
  const inScope = <T extends { facility_id: string | null }>(rows: T[]) =>
    fid ? rows.filter((r) => r.facility_id === fid) : rows;

  const pays = inScope(data.payments);
  const bill = inScope(data.billed);
  const clms = inScope(data.claims);
  const auth = inScope(data.auths);
  const cen = inScope(data.census);
  const rep = inScope(data.repricing);

  // ----- payments (the headline) -----
  let paidCur = 0;
  let paidPrior = 0;
  const payerCur: Record<string, number> = {};
  const payerPrior: Record<string, number> = {};
  for (const p of pays) {
    const m = monthOf(p.period || p.deposit_date);
    const amt = num(p.paid_amount);
    const payer = (p.payment_source || "Unknown").trim() || "Unknown";
    if (m === cur) {
      paidCur += amt;
      payerCur[payer] = (payerCur[payer] ?? 0) + amt;
    } else if (m === prior) {
      paidPrior += amt;
      payerPrior[payer] = (payerPrior[payer] ?? 0) + amt;
    }
  }
  const pct = pctChange(paidCur, paidPrior);
  const direction: Direction =
    pct == null ? (paidCur > 0 ? "up" : "flat") : pct > 2 ? "up" : pct < -2 ? "down" : "flat";

  const drivers: OutlookDriver[] = [];

  // ----- payer / policy mix mover -----
  {
    let topPayer = "";
    let topDelta = 0;
    for (const payer of new Set([...Object.keys(payerCur), ...Object.keys(payerPrior)])) {
      const delta = (payerCur[payer] ?? 0) - (payerPrior[payer] ?? 0);
      if (Math.abs(delta) > Math.abs(topDelta)) {
        topDelta = delta;
        topPayer = payer;
      }
    }
    if (topPayer && Math.abs(topDelta) >= 1000) {
      drivers.push({
        key: "payer",
        label: `Payer · ${topPayer}`,
        direction: topDelta >= 0 ? "up" : "down",
        detail: `${topPayer} paid ${money(payerCur[topPayer] ?? 0)} — ${
          topDelta >= 0 ? "up" : "down"
        } ${money(Math.abs(topDelta))} vs ${monthLabel(prior)}.`,
        impact: Math.abs(topDelta),
      });
    }
  }

  // ----- billed pipeline (leads future payments) -----
  {
    let billedCur = 0;
    let billedPrior = 0;
    for (const b of bill) {
      const m = monthOf(b.period);
      if (m === cur) billedCur += num(b.total_amount);
      else if (m === prior) billedPrior += num(b.total_amount);
    }
    if (billedCur > 0 || billedPrior > 0) {
      const bp = pctChange(billedCur, billedPrior);
      const dir: Direction =
        bp == null ? (billedCur > 0 ? "up" : "flat") : bp > 2 ? "up" : bp < -2 ? "down" : "flat";
      drivers.push({
        key: "billed",
        label: "Billed (pipeline)",
        direction: dir,
        detail: `${money(billedCur)} billed this month${
          bp == null ? "" : ` — ${bp >= 0 ? "up" : "down"} ${Math.abs(bp).toFixed(0)}% vs ${monthLabel(prior)}`
        }; billed now lands as payments later.`,
        impact: Math.abs(billedCur - billedPrior),
      });
    }
  }

  // ----- level-of-care acuity (census) -----
  {
    let accCur = 0;
    let accPrior = 0;
    let nCur = 0;
    let nPrior = 0;
    let expCur = 0;
    let expPrior = 0;
    for (const c of cen) {
      const m = monthOf(c.week_start);
      const w = locWeight(c.level_of_care);
      const exp = w * num(c.gn_rate) * EXPECTED_PCT;
      if (m === cur) {
        accCur += w;
        expCur += exp;
        nCur++;
      } else if (m === prior) {
        accPrior += w;
        expPrior += exp;
        nPrior++;
      }
    }
    if (nCur > 0 || nPrior > 0) {
      const avgCur = nCur ? accCur / nCur : 0;
      const avgPrior = nPrior ? accPrior / nPrior : 0;
      const dir: Direction =
        avgCur > avgPrior * 1.02 ? "up" : avgCur < avgPrior * 0.98 ? "down" : "flat";
      const step =
        dir === "down"
          ? "stepping down (lower-acuity care)"
          : dir === "up"
            ? "stepping up (higher-acuity care)"
            : "holding steady";
      drivers.push({
        key: "loc",
        label: "Level-of-care mix",
        direction: dir,
        detail: `Care mix ${step}; est. census billing ${money(expCur)}${
          nPrior ? ` vs ${money(expPrior)} last month` : ""
        }.`,
        impact: Math.abs(expCur - expPrior),
      });
    }
  }

  // ----- authorization pipeline (drives future billable care) -----
  {
    let active = 0;
    let pastDue = 0;
    let newCur = 0;
    let newPrior = 0;
    for (const a of auth) {
      const dm = dayMs(a.discharge_date);
      const out = a.discharged || (dm != null && dm <= todayMs);
      if (!out) {
        active++;
        const nr = dayMs(a.next_review_date);
        if (nr != null && nr < todayMs) pastDue++;
      }
      const cm = monthOf(a.created_at);
      if (cm === cur) newCur++;
      else if (cm === prior) newPrior++;
    }
    if (auth.length) {
      const dir: Direction =
        pastDue > 0 && newCur <= newPrior ? "risk" : newCur > newPrior ? "up" : newCur < newPrior ? "down" : "flat";
      const parts = [`${active} active auth${active === 1 ? "" : "s"}`];
      if (newCur || newPrior) parts.push(`${newCur} new this month vs ${newPrior} last`);
      if (pastDue) parts.push(`${pastDue} past-due review${pastDue === 1 ? "" : "s"} at risk`);
      drivers.push({
        key: "auths",
        label: "Authorization pipeline",
        direction: dir,
        detail: `${parts.join(" · ")} — fewer active auths means less billable care ahead.`,
        impact: 0,
      });
    }
  }

  // ----- collections aging (current collection risk) -----
  {
    let pri100 = 0;
    let risk65 = 0;
    for (const c of clms) {
      const age = num(c.age_days);
      const bal = num(c.balance);
      if (age >= 100) pri100 += bal;
      else if (age > 65) risk65 += bal;
    }
    if (pri100 > 0 || risk65 > 0) {
      drivers.push({
        key: "aging",
        label: "Collections aging",
        direction: "risk",
        detail: `${money(pri100)} at 100+ days and ${money(risk65)} at 65–99 — older balances collect harder.`,
        impact: pri100,
      });
    }
  }

  // ----- repricing at stake -----
  {
    let atStake = 0;
    for (const r of rep) {
      const open = num(r.total_amount) - num(r.amount_paid);
      const status = String(r.claim_status ?? "");
      if (open > 0 && !/paid in full|closed|complete/i.test(status)) atStake += open;
    }
    if (atStake > 0) {
      drivers.push({
        key: "repricing",
        label: "Repricing at stake",
        direction: "risk",
        detail: `${money(atStake)} in claims awaiting repricing / renegotiation.`,
        impact: atStake,
      });
    }
  }

  // ----- compose the one-line reason -----
  const byImpact = (a: OutlookDriver, b: OutlookDriver) => b.impact - a.impact;
  const drags = drivers
    .filter((d) => d.direction === "down" || d.direction === "risk")
    .sort(byImpact)
    .slice(0, 2);
  const lifts = drivers.filter((d) => d.direction === "up").sort(byImpact).slice(0, 1);
  const trendWord = direction === "up" ? "up" : direction === "down" ? "down" : "flat";
  const pctText = pct == null ? "" : ` ${Math.abs(pct).toFixed(0)}%`;
  const reason =
    `Payments ${trendWord}${pctText} vs ${monthLabel(prior)}.` +
    (drags.length ? ` Drag: ${drags.map((d) => d.label).join(", ")}.` : "") +
    (lifts.length ? ` Lift: ${lifts.map((d) => d.label).join(", ")}.` : "");

  const headline =
    `${money(paidCur)} collected in ${monthLabel(cur)}` +
    (pct == null ? "" : ` · ${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(0)}% vs ${monthLabel(prior)}`);

  // Rank drivers by impact for display, but keep the risk/forward ones visible.
  drivers.sort(byImpact);

  return {
    facility_id: fid,
    facility_name: facility ? facility.short_name || facility.name : "All facilities",
    curMonth: cur,
    priorMonth: prior,
    curLabel: monthLabel(cur),
    priorLabel: monthLabel(prior),
    paidCur,
    paidPrior,
    pct,
    direction,
    headline,
    reason,
    drivers,
  };
}

export function computeOutlooks(data: OutlookInputs, today = new Date()): FacilityOutlook[] {
  // Current month = the latest month present in payments (fall back to billed,
  // then census). Prior = the calendar month before it.
  const months = new Set<string>();
  for (const p of data.payments) {
    const m = monthOf(p.period || p.deposit_date);
    if (m) months.add(m);
  }
  if (months.size === 0)
    for (const b of data.billed) {
      const m = monthOf(b.period);
      if (m) months.add(m);
    }
  if (months.size === 0)
    for (const c of data.census) {
      const m = monthOf(c.week_start);
      if (m) months.add(m);
    }
  const cur = Array.from(months).sort().slice(-1)[0] || monthOf(today.toISOString());
  const prior = addMonth(cur, -1);
  const t = new Date(today);
  t.setHours(0, 0, 0, 0);
  const todayMs = t.getTime();

  const out: FacilityOutlook[] = [buildOne(null, cur, prior, todayMs, data)];
  for (const f of data.facilities) out.push(buildOne(f, cur, prior, todayMs, data));
  return out;
}
