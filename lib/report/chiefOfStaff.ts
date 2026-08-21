import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAll } from "@/lib/supabase/page";
import { money } from "@/lib/format";
import { isExcludedMember, isStaleClaim } from "@/lib/claims";
import { PRIORITY_AGE_THRESHOLD, RISK_AGE_THRESHOLD } from "@/lib/types";
import { censusByFacility, type CensusLike } from "@/lib/report/census";
import { easternToday } from "@/lib/report/eodSummary";

// ---------------------------------------------------------------------------
// Chief-of-Staff morning brief — one management email: "here's what needs
// attention today" across every facility. Aging AR (100+ / 65–99), collections
// this month, medical-records backlog, authorizations (pending + past due),
// census misses, and each collector's claims worked this week.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
type Admin = SupabaseClient<any, any, any>;

const NAVY = "#1b3a5b";
const INK = "#222";
const MUTE = "#555";
const FAINT = "#888";
const POS = "#137333";
const NEG = "#b00020";
const HAIR = "#eee";
const NUM = "font-variant-numeric:tabular-nums";

export interface FacilityBrief {
  id: string;
  name: string;
  outstanding: number;
  collected: number;
  pri100Count: number;
  pri100Bal: number;
  risk65Count: number;
  risk65Bal: number;
  missedGroups: number;
  missedRev: number;
  // Active claims not worked in 30+ days OR never worked — the neglected book.
  neglectedCount: number;
  neglectedBal: number;
}
export interface ChiefBrief {
  facilities: FacilityBrief[];
  network: {
    outstanding: number;
    collected: number;
    pri100Count: number;
    pri100Bal: number;
    risk65Count: number;
    risk65Bal: number;
    missedGroups: number;
    missedRev: number;
    medRecPending: number;
    authsPending: number;
    authsPastDue: number;
    neglectedCount: number;
    neglectedBal: number;
  };
  collectors: { name: string; worked: number }[];
  weekLabel: string;
}

const parseDate = (v: unknown): Date | null => {
  const t = Date.parse(String(v ?? "").trim());
  return isNaN(t) ? null : new Date(t);
};

// Monday..today (inclusive) in Eastern, as YYYY-MM-DD strings.
function weekDates(todayISO: string): string[] {
  const [y, m, d] = todayISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const back = (dt.getUTCDay() + 6) % 7; // days since Monday
  const out: string[] = [];
  for (let i = back; i >= 0; i--) {
    const x = new Date(dt.getTime() - i * 86400000);
    out.push(
      `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}-${String(x.getUTCDate()).padStart(2, "0")}`
    );
  }
  return out;
}
const mdLabel = (iso: string) => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[2])}/${Number(m[3])}` : iso;
};

export async function computeChiefBrief(client: Admin): Promise<ChiefBrief> {
  const now = new Date();
  const today = easternToday();
  const dates = weekDates(today);
  const isThisMonth = (v: unknown) => {
    const d = parseDate(v);
    return !!d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  };
  const today0 = new Date(now);
  today0.setHours(0, 0, 0, 0);

  const safe = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);
  const [facilities, claimsRaw, pays, census, medrecs, auths, prod, cw, cwAll] = await Promise.all([
    safe(
      selectAll<{ id: string; name: string; short_name: string | null }>((f, t) =>
        client.from("facilities").select("id,name,short_name").order("name").range(f, t)
      )
    ),
    safe(
      selectAll<{ facility_id: string | null; claim_id: string | null; member_id: string | null; balance: number | null; age_days: number | null }>(
        (f, t) =>
          client.from("claims").select("facility_id,claim_id,member_id,balance,age_days").eq("present", true).range(f, t)
      )
    ),
    safe(
      selectAll<{ facility_id: string | null; paid_amount: number | null; deposit_date: string | null; payment_entered: string | null }>(
        (f, t) =>
          client.from("payments").select("facility_id,paid_amount,deposit_date,payment_entered").range(f, t)
      )
    ),
    safe(
      selectAll<CensusLike>((f, t) =>
        client.from("census").select("facility_id,level_of_care,week_start,gn_rate,patient_name,days,admit_date").range(f, t)
      )
    ),
    safe(
      selectAll<{ record_status: string | null }>((f, t) =>
        client.from("medical_records").select("record_status").range(f, t)
      )
    ),
    safe(
      selectAll<{ discharged: boolean | null; discharge_date: string | null; next_review_date: string | null; status: string | null }>(
        (f, t) => client.from("authorizations").select("discharged,discharge_date,next_review_date,status").range(f, t)
      )
    ),
    safe(
      selectAll<{ collector_id: string | null; claim_id: string | null }>((f, t) =>
        client.from("production_log").select("collector_id,claim_id").in("worked_on", dates).range(f, t)
      )
    ),
    safe(
      selectAll<{ updated_by: string | null; claim_id: string | null }>((f, t) =>
        client.from("claim_work").select("updated_by,claim_id").in("date_worked", dates).range(f, t)
      )
    ),
    // Every claim's last-worked date (all rows), for the "not worked in 30+ days
    // / never worked" management signal.
    safe(
      selectAll<{ claim_id: string | null; date_worked: string | null }>((f, t) =>
        client.from("claim_work").select("claim_id,date_worked").range(f, t)
      )
    ),
  ]);

  const claims = claimsRaw.filter(
    (c) => !isExcludedMember(c.member_id) && !isStaleClaim(c.age_days)
  );
  // Last-worked date per claim; a claim is "neglected" if it was worked more
  // than 30 days ago, or has never been worked at all.
  const lastWorked = new Map<string, string>();
  for (const w of cwAll) {
    if (w.claim_id && w.date_worked) lastWorked.set(w.claim_id, w.date_worked);
  }
  const neglectCutoff = today0.getTime() - 30 * 86400000;
  const isNeglected = (claimId: string | null): boolean => {
    const dw = claimId ? lastWorked.get(claimId) : null;
    if (!dw) return true; // never worked
    const t = Date.parse(dw);
    return isNaN(t) || t < neglectCutoff; // worked over a month ago
  };
  const censusOf = new Map(
    censusByFacility(
      facilities.map((f) => f.id),
      census
    ).map((s) => [s.facilityId, s])
  );

  const rows: FacilityBrief[] = facilities.map((f) => {
    let outstanding = 0,
      pri100Count = 0,
      pri100Bal = 0,
      risk65Count = 0,
      risk65Bal = 0,
      neglectedCount = 0,
      neglectedBal = 0;
    for (const c of claims) {
      if (c.facility_id !== f.id) continue;
      const bal = c.balance ?? 0;
      const age = c.age_days ?? 0;
      outstanding += bal;
      if (age >= PRIORITY_AGE_THRESHOLD) {
        pri100Count++;
        pri100Bal += bal;
      } else if (age > RISK_AGE_THRESHOLD) {
        risk65Count++;
        risk65Bal += bal;
      }
      if (isNeglected(c.claim_id)) {
        neglectedCount++;
        neglectedBal += bal;
      }
    }
    const collected = pays
      .filter((p) => p.facility_id === f.id && (isThisMonth(p.deposit_date) || isThisMonth(p.payment_entered)))
      .reduce((s, p) => s + (p.paid_amount ?? 0), 0);
    const cs = censusOf.get(f.id);
    return {
      id: f.id,
      name: f.short_name || f.name,
      outstanding,
      collected,
      pri100Count,
      pri100Bal,
      risk65Count,
      risk65Bal,
      missedGroups: cs?.missedGroups ?? 0,
      missedRev: cs?.missedRev ?? 0,
      neglectedCount,
      neglectedBal,
    };
  });
  rows.sort((a, b) => b.pri100Bal - a.pri100Bal || b.outstanding - a.outstanding);

  // Medical records still pending (requested / not yet handled).
  const medRecPending = medrecs.filter((m) => {
    const s = String(m.record_status ?? "").trim().toLowerCase();
    return s === "" || s === "requested";
  }).length;

  // Authorizations. A patient is ACTIVE while there's no discharge date. But
  // "pending" is NOT every active patient — it only counts ones the auth
  // specialist actually SET to status "Pending" (an active patient with no
  // pending status set shouldn't inflate the number). "Past due" = a pending
  // auth whose review date has already passed.
  let authsPending = 0,
    authsPastDue = 0;
  for (const a of auths) {
    const dm = parseDate(a.discharge_date);
    const active = !a.discharged && !(dm && dm <= today0);
    if (!active) continue;
    const isPending = String(a.status ?? "").trim().toLowerCase() === "pending";
    if (!isPending) continue;
    authsPending++;
    const nr = parseDate(a.next_review_date);
    if (nr && nr < today0) authsPastDue++;
  }

  // Collectors this week: distinct claims worked per collector (queue + any tab).
  const byCollector = new Map<string, Set<string>>();
  const add = (id: string | null, claim: string | null) => {
    if (!id || !claim) return;
    if (!byCollector.has(id)) byCollector.set(id, new Set());
    byCollector.get(id)!.add(claim);
  };
  for (const p of prod) add(p.collector_id, p.claim_id);
  for (const c of cw) add(c.updated_by, c.claim_id);
  const profs = byCollector.size
    ? await safe(
        selectAll<{ id: string; full_name: string | null; initials: string | null }>((f, t) =>
          client
            .from("profiles")
            .select("id,full_name,initials")
            .in("id", Array.from(byCollector.keys()))
            .range(f, t)
        )
      )
    : [];
  const nameOf = new Map(profs.map((p) => [p.id, p.full_name?.trim() || p.initials?.trim() || "Collector"]));
  const collectors = Array.from(byCollector.entries())
    .map(([id, set]) => ({ name: nameOf.get(id) || "Collector", worked: set.size }))
    .filter((c) => c.worked > 0)
    .sort((a, b) => b.worked - a.worked);

  const network = {
    outstanding: rows.reduce((s, r) => s + r.outstanding, 0),
    collected: rows.reduce((s, r) => s + r.collected, 0),
    pri100Count: rows.reduce((s, r) => s + r.pri100Count, 0),
    pri100Bal: rows.reduce((s, r) => s + r.pri100Bal, 0),
    risk65Count: rows.reduce((s, r) => s + r.risk65Count, 0),
    risk65Bal: rows.reduce((s, r) => s + r.risk65Bal, 0),
    missedGroups: rows.reduce((s, r) => s + r.missedGroups, 0),
    missedRev: rows.reduce((s, r) => s + r.missedRev, 0),
    medRecPending,
    authsPending,
    authsPastDue,
    neglectedCount: rows.reduce((s, r) => s + r.neglectedCount, 0),
    neglectedBal: rows.reduce((s, r) => s + r.neglectedBal, 0),
  };

  return { facilities: rows, network, collectors, weekLabel: `${mdLabel(dates[0])}–${mdLabel(today)}` };
}

function stat(label: string, value: string, color: string, sub?: string): string {
  return `<td style="padding:0 14px 8px 0;vertical-align:top;width:25%">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:${MUTE}">${label}</div>
    <div style="font-size:20px;font-weight:700;color:${color};margin-top:3px;${NUM}">${value}</div>
    ${sub ? `<div style="font-size:11px;color:${FAINT};margin-top:1px">${sub}</div>` : ""}
  </td>`;
}
function head(title: string): string {
  return `<div style="border-top:1px solid ${NAVY};margin:24px 0 0"></div>
    <div style="font-weight:700;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${NAVY};padding:9px 0 10px">${title}</div>`;
}

export function renderChiefBrief(b: ChiefBrief, date: string): string {
  const nice = new Date(date + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const n = b.network;
  const focus = b.facilities
    .filter((f) => f.pri100Bal > 0)
    .slice(0, 3)
    .map((f) => `<b>${f.name}</b> ${money(f.pri100Bal)} in 100+`)
    .join(" · ");

  const facRows = b.facilities
    .map(
      (f) => `<tr>
        <td style="padding:7px 0;border-bottom:1px solid ${HAIR};font-weight:600">${f.name}</td>
        <td style="padding:7px 0;border-bottom:1px solid ${HAIR};text-align:right;${NUM}">${money(f.outstanding)}</td>
        <td style="padding:7px 0;border-bottom:1px solid ${HAIR};text-align:right;color:${POS};${NUM}">${money(f.collected)}</td>
        <td style="padding:7px 0;border-bottom:1px solid ${HAIR};text-align:right;color:${f.pri100Count ? NEG : FAINT};font-weight:${f.pri100Count ? 700 : 400};${NUM}">${f.pri100Count}</td>
        <td style="padding:7px 0;border-bottom:1px solid ${HAIR};text-align:right;color:${FAINT};${NUM}">${f.risk65Count}</td>
        <td style="padding:7px 0;border-bottom:1px solid ${HAIR};text-align:right;color:${f.missedGroups ? NEG : FAINT};${NUM}">${f.missedGroups}</td>
        <td style="padding:7px 0;border-bottom:1px solid ${HAIR};text-align:right;color:${f.missedRev > 0 ? NEG : FAINT};${NUM}">${money(f.missedRev)}</td>
        <td style="padding:7px 0;border-bottom:1px solid ${HAIR};text-align:right;color:${f.neglectedCount ? NEG : FAINT};font-weight:${f.neglectedCount ? 700 : 400};${NUM}" title="${money(f.neglectedBal)}">${f.neglectedCount}</td>
      </tr>`
    )
    .join("");

  const collectorRows = b.collectors.length
    ? b.collectors
        .map(
          (c) => `<tr>
            <td style="padding:6px 0;border-bottom:1px solid ${HAIR}">${c.name}</td>
            <td style="padding:6px 0;border-bottom:1px solid ${HAIR};text-align:right;font-weight:600;${NUM}">${c.worked}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="2" style="padding:8px 0;color:${FAINT}">No claims logged worked this week yet.</td></tr>`;

  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:${INK};background:#fff;padding:30px 28px 24px;line-height:1.6">
    <div style="font-weight:700;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:${NAVY}">BC Billing</div>
    <div style="font-size:26px;font-weight:800;color:${NAVY};margin:8px 0 2px;letter-spacing:-.01em">Chief of Staff — Morning Brief</div>
    <div style="color:${MUTE};border-bottom:2px solid ${NAVY};padding-bottom:14px">${nice}</div>

    <table style="border-collapse:collapse;width:100%;margin-top:20px"><tbody>
      <tr>
        ${stat("Outstanding AR", money(n.outstanding), NAVY)}
        ${stat("Collected · This month", money(n.collected), POS)}
        ${stat("100+ Priority", String(n.pri100Count), NEG, money(n.pri100Bal))}
        ${stat("65–99 Risk", String(n.risk65Count), "#a8730b", money(n.risk65Bal))}
      </tr>
      <tr>
        ${stat("Auths Pending", String(n.authsPending), n.authsPending ? NAVY : POS)}
        ${stat("Auths Past Due", String(n.authsPastDue), n.authsPastDue ? NEG : POS)}
        ${stat("Med Records Pending", String(n.medRecPending), n.medRecPending ? NAVY : POS)}
        ${stat("Missed Revenue", money(n.missedRev), n.missedRev > 0 ? NEG : POS)}
      </tr>
      <tr>
        ${stat("Not worked 30d+ / never", String(n.neglectedCount), n.neglectedCount ? NEG : POS, `${money(n.neglectedBal)} sitting untouched`)}
        <td style="width:75%"></td>
      </tr>
    </tbody></table>

    ${focus ? `${head("Where to focus today")}<div style="color:${INK}">${focus}</div>` : ""}

    ${head(`Collectors this week (${b.weekLabel})`)}
    <table style="border-collapse:collapse;width:100%;font-size:13px;max-width:360px">
      <thead><tr style="text-align:left;color:${FAINT};font-size:11px;text-transform:uppercase;letter-spacing:.04em">
        <th style="padding:4px 0">Collector</th><th style="padding:4px 0;text-align:right">Claims worked</th>
      </tr></thead>
      <tbody>${collectorRows}</tbody>
    </table>

    ${head("By facility")}
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      <thead><tr style="text-align:left;color:${FAINT};font-size:11px;text-transform:uppercase;letter-spacing:.04em">
        <th style="padding:4px 0">Facility</th>
        <th style="padding:4px 0;text-align:right">Outstanding</th>
        <th style="padding:4px 0;text-align:right">Collected</th>
        <th style="padding:4px 0;text-align:right">100+</th>
        <th style="padding:4px 0;text-align:right">65–99</th>
        <th style="padding:4px 0;text-align:right">Missed groups</th>
        <th style="padding:4px 0;text-align:right">Missed rev</th>
        <th style="padding:4px 0;text-align:right">Not worked 30d+</th>
      </tr></thead>
      <tbody>${facRows}</tbody>
    </table>

    <hr style="border:none;border-top:1px solid #ddd;margin-top:24px" />
    <p style="font-size:11px;color:${FAINT}">Automated Chief-of-Staff brief from BC Billing. Contains PHI — handle per HIPAA.</p>
  </div>`;
}
