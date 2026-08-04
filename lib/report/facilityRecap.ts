import type { SupabaseClient } from "@supabase/supabase-js";
import { money } from "@/lib/format";
import { isExcludedMember, isRiskPayer } from "@/lib/claims";
import { computeOutlooks, type FacilityOutlook } from "./moneyOutlook";
import { facilityCensusWeek, type CensusWeekSummary } from "./census";

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
  member_id: string | null;
  balance: number | null;
  age_days: number | null;
  claim_status: string | null;
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
  patient_name: string | null;
};
type BilledRow = {
  facility_id: string | null;
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
  census: CensusWeekSummary | null; // prior week: patients, missed groups, missed rev
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
function isSameMonth(v: unknown, now: Date): boolean {
  const d = parseDate(v);
  return !!d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
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
  const only = opts?.facilityIds && opts.facilityIds.length ? new Set(opts.facilityIds) : null;
  const scopeIn = (q: any) => (only ? q.in("facility_id", Array.from(only)) : q);

  const [facilitiesAll, claimsRaw, payments, billed, negs, auths, census, repricing] =
    await Promise.all([
      pageAll<{ id: string; name: string; short_name: string | null }>(client, (a) =>
        a.from("facilities").select("id,name,short_name").order("name")
      ),
      pageAll<ClaimRow>(client, (a) =>
        scopeIn(
          a
            .from("claims")
            .select("facility_id,member_id,balance,age_days,claim_status")
            .eq("present", true)
        )
      ),
      pageAll<PayRow>(client, (a) =>
        scopeIn(
          a
            .from("payments")
            .select(
              "facility_id,paid_amount,payment_source,deposit_date,payment_entered,period,cpt_description,dos_from,patient_name"
            )
        )
      ).catch(() => []),
      pageAll<BilledRow>(client, (a) =>
        scopeIn(
          a
            .from("billed_claims")
            .select("facility_id,total_amount,period,entered_date,loc_units,patient_name")
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
          a.from("census").select("facility_id,level_of_care,week_start,gn_rate,patient_name,days")
        )
      ).catch(() => []),
      pageAll<any>(client, (a) =>
        scopeIn(a.from("repricing").select("facility_id,total_amount,amount_paid,claim_status"))
      ).catch(() => []),
    ]);

  const facilities = only ? facilitiesAll.filter((f) => only.has(f.id)) : facilitiesAll;
  const claims = claimsRaw.filter((c) => !isExcludedMember(c.member_id));

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

    const monthPays = payments.filter(
      (p) =>
        p.facility_id === f.id &&
        (isSameMonth(p.deposit_date, now) || isSameMonth(p.payment_entered, now))
    );
    const collectedThisMonth = monthPays.reduce((s, p) => s + (p.paid_amount ?? 0), 0);
    const payByPayer = new Map<string, number>();
    for (const p of monthPays) {
      const src = (p.payment_source || "Other").toUpperCase();
      payByPayer.set(src, (payByPayer.get(src) ?? 0) + (p.paid_amount ?? 0));
    }

    const billedInMonth = (key: string, when: Date) =>
      billed.filter(
        (b) =>
          b.facility_id === f.id &&
          (b.period ? b.period === key : isSameMonth(b.entered_date, when))
      );
    const billedThisMonth = billedInMonth(monthKey, now).reduce((s, b) => s + (b.total_amount ?? 0), 0);
    const billedLastMonth = billedInMonth(priorKey, prior).reduce((s, b) => s + (b.total_amount ?? 0), 0);

    // Level-of-care sessions billed each month, from the billed CPT units — the
    // accurate "why" behind a billing swing (PHP/IOP/OP this month vs last).
    const locSessions = (key: string, when: Date) => {
      const acc: Record<string, number> = {};
      for (const b of billedInMonth(key, when)) {
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
        const stem = `Billing is ${dir} ${money(Math.abs(billedDelta))} (${Math.abs(
          billedPct ?? 0
        )}%) vs ${priorMonthLabel}.`;
        billingNote = top
          ? `${stem} Biggest driver: ${top.loc} sessions ${top.cur} vs ${top.prior} last month (${
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
      census: facilityCensusWeek(f.id, census),
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

const dirArrow = (d: string) =>
  d === "up" ? "▲" : d === "down" ? "▼" : d === "risk" ? "⚠" : "▬";
const dirColor = (d: string) =>
  d === "up" ? POS : d === "down" || d === "risk" ? NEG : "#666";

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
  const o = r.outlook;

  const drivers = (o?.drivers ?? [])
    .map(
      (d) => `<div style="margin:6px 0">
        <span style="color:${dirColor(d.direction)}">${dirArrow(d.direction)}</span>
        <b>${d.label}</b> — <span style="color:#555">${d.detail}</span>
      </div>`
    )
    .join("");

  const locRows = (o?.locBilling ?? [])
    .map(
      (l) => `<tr>
        <td style="padding:3px 8px;border-bottom:1px solid #eee">${l.loc}</td>
        <td style="padding:3px 8px;border-bottom:1px solid #eee;text-align:right">${l.curServices}</td>
        <td style="padding:3px 8px;border-bottom:1px solid #eee;text-align:right;color:#888">${l.priorServices}</td>
        <td style="padding:3px 8px;border-bottom:1px solid #eee;text-align:right">${l.curClients} / ${l.priorClients}</td>
      </tr>`
    )
    .join("");

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
      ? `${sectionHead("Billing vs last month")}
          <table style="border-collapse:collapse;width:100%;margin-bottom:2px"><tr>
            ${statTile(`Billed · ${r.monthLabel}`, money(r.billedThisMonth), INK)}
            ${statTile(`Billed · ${r.priorMonthLabel}`, money(r.billedLastMonth), INK)}
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
                    <th style="padding:4px 0;text-align:right">Sessions · ${r.monthLabel}</th>
                    <th style="padding:4px 0;text-align:right">Sessions · ${r.priorMonthLabel}</th>
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

    ${
      o
        ? `${sectionHead(`Money Outlook — ${o.curLabel} vs ${o.priorLabel}`)}
            <div style="margin:0 0 8px">
              <span style="color:${dirColor(o.direction)};font-weight:700">${dirArrow(o.direction)} ${
                o.pct != null ? `${o.pct > 0 ? "+" : ""}${o.pct.toFixed(0)}%` : ""
              }</span>
              &nbsp;${o.headline}
            </div>
            <div style="color:${MUTE};margin-bottom:6px">${o.reason}</div>
            ${drivers}
            ${
              locRows
                ? `<table style="border-collapse:collapse;width:100%;font-size:13px;margin-top:10px">
                    <thead><tr style="text-align:left;color:${FAINT};font-size:11px;text-transform:uppercase;letter-spacing:.05em">
                      <th style="padding:4px 0">Level of care</th>
                      <th style="padding:4px 0;text-align:right">Services (now)</th>
                      <th style="padding:4px 0;text-align:right">Prior</th>
                      <th style="padding:4px 0;text-align:right">Clients (now / prior)</th>
                    </tr></thead><tbody>${locRows}</tbody></table>`
                : ""
            }
            <div style="color:${MUTE};margin-top:8px">🔮 ${o.forecast}</div>`
        : ""
    }

    ${
      r.census
        ? `${sectionHead(`Census · ${r.census.weekLabel} (prior week)`)}
            <table style="border-collapse:collapse;width:100%"><tr>
              ${statTile("Census (Patients)", String(r.census.patients), INK)}
              ${statTile("Missed Groups", String(r.census.missedGroups), r.census.missedGroups > 0 ? NEG : POS)}
              ${statTile("Missed Revenue", money(r.census.missedRev), r.census.missedRev > 0 ? NEG : POS)}
              <td style="width:25%"></td>
            </tr></table>`
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
