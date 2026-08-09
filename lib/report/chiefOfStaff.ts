import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAll } from "@/lib/supabase/page";
import { money } from "@/lib/format";
import { isExcludedMember } from "@/lib/claims";
import { PRIORITY_AGE_THRESHOLD, RISK_AGE_THRESHOLD } from "@/lib/types";
import { censusByFacility, type CensusLike } from "@/lib/report/census";

// ---------------------------------------------------------------------------
// Chief-of-Staff morning brief — a single management email that says "here's
// what needs attention today" across every facility: aging AR priorities
// (100+ / 65–99), open authorization issues, and census misses (missed groups
// and the revenue they cost). Same navy styling as the recaps.
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
  pri100Count: number;
  pri100Bal: number;
  risk65Count: number;
  risk65Bal: number;
  openIssues: number;
  missedGroups: number;
  missedRev: number;
}
export interface ChiefBrief {
  facilities: FacilityBrief[];
  network: Omit<FacilityBrief, "id" | "name">;
}

type ClaimRow = { facility_id: string | null; member_id: string | null; balance: number | null; age_days: number | null };

export async function computeChiefBrief(client: Admin): Promise<ChiefBrief> {
  const safe = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);
  const [facilities, claimsRaw, issues, census] = await Promise.all([
    safe(
      selectAll<{ id: string; name: string; short_name: string | null }>((f, t) =>
        client.from("facilities").select("id,name,short_name").order("name").range(f, t)
      )
    ),
    safe(
      selectAll<ClaimRow>((f, t) =>
        client.from("claims").select("facility_id,member_id,balance,age_days").eq("present", true).range(f, t)
      )
    ),
    safe(
      selectAll<{ facility_id: string | null }>((f, t) =>
        client.from("auth_issues").select("facility_id").neq("status", "Completed").range(f, t)
      )
    ),
    safe(
      selectAll<CensusLike>((f, t) =>
        client
          .from("census")
          .select("facility_id,level_of_care,week_start,gn_rate,patient_name,days")
          .range(f, t)
      )
    ),
  ]);

  const claims = claimsRaw.filter((c) => !isExcludedMember(c.member_id));
  const censusSummaries = censusByFacility(
    facilities.map((f) => f.id),
    census
  );
  const censusOf = new Map(censusSummaries.map((s) => [s.facilityId, s]));

  const rows: FacilityBrief[] = facilities.map((f) => {
    const fc = claims.filter((c) => c.facility_id === f.id);
    let outstanding = 0;
    let pri100Count = 0;
    let pri100Bal = 0;
    let risk65Count = 0;
    let risk65Bal = 0;
    for (const c of fc) {
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
    }
    const cs = censusOf.get(f.id);
    return {
      id: f.id,
      name: f.short_name || f.name,
      outstanding,
      pri100Count,
      pri100Bal,
      risk65Count,
      risk65Bal,
      openIssues: issues.filter((i) => i.facility_id === f.id).length,
      missedGroups: cs?.missedGroups ?? 0,
      missedRev: cs?.missedRev ?? 0,
    };
  });

  rows.sort((a, b) => b.pri100Bal - a.pri100Bal || b.outstanding - a.outstanding);

  const network = rows.reduce(
    (s, r) => ({
      outstanding: s.outstanding + r.outstanding,
      pri100Count: s.pri100Count + r.pri100Count,
      pri100Bal: s.pri100Bal + r.pri100Bal,
      risk65Count: s.risk65Count + r.risk65Count,
      risk65Bal: s.risk65Bal + r.risk65Bal,
      openIssues: s.openIssues + r.openIssues,
      missedGroups: s.missedGroups + r.missedGroups,
      missedRev: s.missedRev + r.missedRev,
    }),
    { outstanding: 0, pri100Count: 0, pri100Bal: 0, risk65Count: 0, risk65Bal: 0, openIssues: 0, missedGroups: 0, missedRev: 0 }
  );

  return { facilities: rows, network };
}

function stat(label: string, value: string, color: string, sub?: string): string {
  return `<td style="padding:0 14px 0 0;vertical-align:top;width:16.6%">
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

  // "Where to focus" — the three facilities carrying the most 100+ balance.
  const focus = b.facilities
    .filter((f) => f.pri100Bal > 0)
    .slice(0, 3)
    .map((f) => `<b>${f.name}</b> ${money(f.pri100Bal)} in 100+`)
    .join(" · ");

  const rows = b.facilities
    .map(
      (f) => `<tr>
        <td style="padding:7px 0;border-bottom:1px solid ${HAIR};font-weight:600">${f.name}</td>
        <td style="padding:7px 0;border-bottom:1px solid ${HAIR};text-align:right;${NUM}">${money(f.outstanding)}</td>
        <td style="padding:7px 0;border-bottom:1px solid ${HAIR};text-align:right;color:${f.pri100Count ? NEG : FAINT};font-weight:${f.pri100Count ? 700 : 400};${NUM}">${f.pri100Count}</td>
        <td style="padding:7px 0;border-bottom:1px solid ${HAIR};text-align:right;color:${FAINT};${NUM}">${f.risk65Count}</td>
        <td style="padding:7px 0;border-bottom:1px solid ${HAIR};text-align:right;color:${f.openIssues ? NAVY : FAINT};${NUM}">${f.openIssues}</td>
        <td style="padding:7px 0;border-bottom:1px solid ${HAIR};text-align:right;color:${f.missedGroups ? NEG : FAINT};${NUM}">${f.missedGroups}</td>
        <td style="padding:7px 0;border-bottom:1px solid ${HAIR};text-align:right;color:${f.missedRev > 0 ? NEG : FAINT};${NUM}">${money(f.missedRev)}</td>
      </tr>`
    )
    .join("");

  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:${INK};background:#fff;padding:30px 28px 24px;line-height:1.6">
    <div style="font-weight:700;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:${NAVY}">BC Billing</div>
    <div style="font-size:26px;font-weight:800;color:${NAVY};margin:8px 0 2px;letter-spacing:-.01em">Chief of Staff — Morning Brief</div>
    <div style="color:${MUTE};border-bottom:2px solid ${NAVY};padding-bottom:14px">${nice}</div>

    <table style="border-collapse:collapse;width:100%;margin-top:20px"><tr>
      ${stat("Outstanding AR", money(n.outstanding), NAVY)}
      ${stat("100+ Priority", String(n.pri100Count), NEG, money(n.pri100Bal))}
      ${stat("65–99 Risk", String(n.risk65Count), "#a8730b", money(n.risk65Bal))}
      ${stat("Open Auth Issues", String(n.openIssues), n.openIssues ? NAVY : POS)}
      ${stat("Missed Groups", String(n.missedGroups), n.missedGroups ? NEG : POS)}
      ${stat("Missed Revenue", money(n.missedRev), n.missedRev > 0 ? NEG : POS)}
    </tr></table>

    ${focus ? `${head("Where to focus today")}<div style="color:${INK}">${focus}</div>` : ""}

    ${head("By facility")}
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      <thead><tr style="text-align:left;color:${FAINT};font-size:11px;text-transform:uppercase;letter-spacing:.04em">
        <th style="padding:4px 0">Facility</th>
        <th style="padding:4px 0;text-align:right">Outstanding</th>
        <th style="padding:4px 0;text-align:right">100+</th>
        <th style="padding:4px 0;text-align:right">65–99</th>
        <th style="padding:4px 0;text-align:right">Auth issues</th>
        <th style="padding:4px 0;text-align:right">Missed groups</th>
        <th style="padding:4px 0;text-align:right">Missed rev</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <hr style="border:none;border-top:1px solid #ddd;margin-top:24px" />
    <p style="font-size:11px;color:${FAINT}">Automated Chief-of-Staff brief from BC Billing. Contains PHI — handle per HIPAA.</p>
  </div>`;
}
