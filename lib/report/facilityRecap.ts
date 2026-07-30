import type { SupabaseClient } from "@supabase/supabase-js";
import { money } from "@/lib/format";
import { isExcludedMember, isRiskPayer } from "@/lib/claims";
import { computeOutlooks, type FacilityOutlook } from "./moneyOutlook";

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
    };
  });
}

// Facility id → its login email(s): profiles with role='facility' whose primary
// facility_id matches, or who are granted the facility via assignments. Emails
// via getUserById (direct, most reliable). NEEDS the service-role client.
export async function facilityRecipients(admin: Admin): Promise<Map<string, string[]>> {
  const [{ data: profs }, { data: asgs }] = await Promise.all([
    admin.from("profiles").select("id,facility_id").eq("role", "facility"),
    admin.from("assignments").select("profile_id,facility_id"),
  ]);
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

// ---- HTML rendering (mirrors the /facility dashboard) ---------------------

const dirArrow = (d: string) =>
  d === "up" ? "▲" : d === "down" ? "▼" : d === "risk" ? "⚠" : "▬";
const dirColor = (d: string) =>
  d === "up" ? "#137333" : d === "down" || d === "risk" ? "#b00020" : "#666";

function statTile(label: string, value: string, color: string, sub?: string): string {
  return `<td style="padding:12px 14px;border:1px solid #eee;border-radius:10px;vertical-align:top;width:25%">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#888">${label}</div>
    <div style="font-size:21px;font-weight:700;color:${color}">${value}</div>
    ${sub ? `<div style="font-size:11px;color:#999">${sub}</div>` : ""}
  </td>`;
}

function breakdown(title: string, total: number, rows: [string, number][], accent: string, empty: string): string {
  const body = rows
    .map(([label, val]) => {
      const pct = total > 0 ? Math.round((val / total) * 100) : 0;
      const flag = isRiskPayer(label) ? ' <span style="color:#b00020">⚠</span>' : "";
      return `<tr>
        <td style="padding:4px 8px;border-bottom:1px solid #eee">${label}${flag}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:600;color:${accent}">${money(val)}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;color:#888">${pct}%</td>
      </tr>`;
    })
    .join("");
  return `<h3 style="margin:18px 0 6px">${title} <span style="color:#888;font-weight:400">${money(total)}</span></h3>
    ${
      rows.length
        ? `<table style="border-collapse:collapse;width:100%;font-size:13px"><tbody>${body}</tbody></table>`
        : `<p style="color:#888;margin:0">${empty}</p>`
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
      const c = l.delta < 0 ? "#b00020" : l.delta > 0 ? "#137333" : "#888";
      return `<tr>
        <td style="padding:3px 8px;border-bottom:1px solid #eee">${l.loc}</td>
        <td style="padding:3px 8px;border-bottom:1px solid #eee;text-align:right">${l.cur}</td>
        <td style="padding:3px 8px;border-bottom:1px solid #eee;text-align:right;color:#888">${l.prior}</td>
        <td style="padding:3px 8px;border-bottom:1px solid #eee;text-align:right;color:${c}">${l.delta > 0 ? "+" : ""}${l.delta}</td>
      </tr>`;
    })
    .join("");
  const billingBlock =
    r.billedThisMonth > 0 || r.billedLastMonth > 0
      ? `<div style="margin:16px 0;padding:12px 14px;border:1px solid #eee;border-radius:10px">
          <div style="font-weight:700;margin-bottom:6px">Billing vs last month</div>
          <table style="border-collapse:separate;border-spacing:6px;width:100%"><tr>
            ${statTile(`Billed · ${r.monthLabel}`, money(r.billedThisMonth), "#222")}
            ${statTile(`Billed · ${r.priorMonthLabel}`, money(r.billedLastMonth), "#222")}
            ${statTile(
              "Change",
              `${r.billedDelta < 0 ? "−" : "+"}${money(Math.abs(r.billedDelta))}`,
              r.billedDelta < 0 ? "#b00020" : "#137333",
              r.billedPct != null ? `${r.billedPct > 0 ? "+" : ""}${r.billedPct}%` : undefined
            )}
          </tr></table>
          ${
            billLocRows
              ? `<table style="border-collapse:collapse;width:100%;font-size:13px;margin-top:6px">
                  <thead><tr style="text-align:left;color:#888">
                    <th style="padding:3px 8px">Level of care</th>
                    <th style="padding:3px 8px;text-align:right">Sessions · ${r.monthLabel}</th>
                    <th style="padding:3px 8px;text-align:right">Sessions · ${r.priorMonthLabel}</th>
                    <th style="padding:3px 8px;text-align:right">Change</th>
                  </tr></thead><tbody>${billLocRows}</tbody></table>`
              : ""
          }
          ${r.billingNote ? `<div style="margin-top:8px;color:#333">${r.billingNote}</div>` : ""}
        </div>`
      : "";

  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6">
    <h2 style="margin:0 0 2px">${r.name} — Daily Recap</h2>
    <p style="margin:0 0 16px;color:#555">${nice}</p>

    <table style="border-collapse:separate;border-spacing:6px;width:100%">
      <tr>
        ${statTile("Total AR (Outstanding)", money(r.totalAR), "#a8730b")}
        ${statTile("Expected Revenue", money(r.expectedRevenue), "#1a56db", `${Math.round(EXPECTED_RATE * 100)}% of AR`)}
        ${statTile(`Collected · ${r.monthLabel}`, money(r.collectedThisMonth), "#137333")}
        ${statTile(`Billed · ${r.monthLabel}`, money(r.billedThisMonth), "#222")}
      </tr>
    </table>

    ${billingBlock}

    ${
      o
        ? `<div style="margin:18px 0;padding:12px 14px;border:1px solid #eee;border-radius:10px;background:#fafafa">
            <div style="font-weight:700;margin-bottom:2px">Money Outlook — ${o.curLabel} vs ${o.priorLabel}</div>
            <div style="margin:2px 0 8px">
              <span style="color:${dirColor(o.direction)};font-weight:700">${dirArrow(o.direction)} ${
                o.pct != null ? `${o.pct > 0 ? "+" : ""}${o.pct.toFixed(0)}%` : ""
              }</span>
              &nbsp;${o.headline}
            </div>
            <div style="color:#444;margin-bottom:6px">${o.reason}</div>
            ${drivers}
            ${
              locRows
                ? `<table style="border-collapse:collapse;width:100%;font-size:13px;margin-top:10px">
                    <thead><tr style="text-align:left;color:#888">
                      <th style="padding:3px 8px">Level of care</th>
                      <th style="padding:3px 8px;text-align:right">Services (now)</th>
                      <th style="padding:3px 8px;text-align:right">Prior</th>
                      <th style="padding:3px 8px;text-align:right">Clients (now / prior)</th>
                    </tr></thead><tbody>${locRows}</tbody></table>`
                : ""
            }
            <div style="color:#666;margin-top:8px">🔮 ${o.forecast}</div>
          </div>`
        : ""
    }

    ${
      r.riskAR > 0
        ? `<div style="margin:16px 0;padding:12px 14px;border:1px solid #f2c2c2;border-radius:10px;background:#fdf3f3">
            <div style="display:flex;justify-content:space-between;gap:12px">
              <div>
                <div style="font-weight:700;color:#b00020">⚠ Risk of non-reimbursement</div>
                <div style="font-size:12px;color:#777">Marketplace / exchange plans — Highmark, Capital Blue Cross, Independence Blue Cross. Prioritize before these age out.</div>
              </div>
              <div style="text-align:right;white-space:nowrap">
                <div style="font-size:20px;font-weight:700;color:#b00020">${money(r.riskAR)}</div>
                <div style="font-size:12px;color:#777">${r.totalAR > 0 ? Math.round((r.riskAR / r.totalAR) * 100) : 0}% of AR</div>
              </div>
            </div>
          </div>`
        : ""
    }

    ${breakdown("Outstanding AR by payer", r.totalAR, r.arRows, "#a8730b", "No outstanding balance on file.")}
    ${breakdown(`Payments collected · ${r.monthLabel} — by payer`, r.collectedThisMonth, r.payRows, "#137333", `No payments recorded yet for ${r.monthLabel}.`)}

    <h3 style="margin:18px 0 6px">Negotiations — expected revenue</h3>
    ${
      r.approvedNegCount === 0
        ? `<p style="color:#888;margin:0">No approved negotiations on file.</p>`
        : `<table style="border-collapse:separate;border-spacing:6px;width:100%"><tr>
            ${statTile("Awaiting payment", String(r.negOpen), "#222", `${r.approvedNegCount} approved on file`)}
            ${statTile("Expected revenue", money(r.negExpected), "#1a56db", "not yet landed")}
            ${statTile("Landing within 14 days", money(r.negDueSoon), "#137333", `paid ~${NEG_PAY_LAG_DAYS} days after approval`)}
          </tr></table>`
    }

    <hr style="border:none;border-top:1px solid #ddd;margin-top:22px" />
    <p style="font-size:11px;color:#888">Automated daily recap from BC Billing. Contains PHI — handle per HIPAA.</p>
  </div>`;
}
