import type { SupabaseClient } from "@supabase/supabase-js";
import { money } from "@/lib/format";
import { isExcludedMember } from "@/lib/claims";
import { RISK_AGE_THRESHOLD, PRIORITY_AGE_THRESHOLD } from "@/lib/types";
import { computeOutlooks, type FacilityOutlook } from "./moneyOutlook";

// ---------------------------------------------------------------------------
// Facility daily recap — the same picture the management Overview page shows,
// but scoped to ONE facility and mailed to that facility's own login. Reuses
// the service-role (admin) client so the 5:30 PM cron can read every facility's
// data without a user session. A facility only ever receives its own numbers.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
type Admin = SupabaseClient<any, any, any>;

// Page through a table with the admin client (no RLS), 1000 rows at a time.
async function pageAll<T>(
  admin: Admin,
  build: (q: any) => any
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await build(admin).range(from, from + 999);
    const rows = (data as T[]) ?? [];
    if (error) break;
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

type Claim = {
  claim_id: string;
  facility_id: string;
  patient_name: string | null;
  member_id: string | null;
  dos_from: string | null;
  charge_amount: number | null;
  balance: number | null;
  age_days: number | null;
  claim_status: string | null;
};

export interface FacilityRecap {
  facilityId: string;
  name: string;
  charged: number;
  recovered: number;
  balance: number;
  pri100Count: number;
  pri100Balance: number;
  risk65Count: number;
  risk65Balance: number;
  openIssues: number;
  outlook: FacilityOutlook | null;
  worst100: Claim[];
  worst65: Claim[];
}

const isPriority = (c: Claim) => (c.age_days ?? 0) >= PRIORITY_AGE_THRESHOLD;
const isRisk65 = (c: Claim) =>
  (c.age_days ?? 0) > RISK_AGE_THRESHOLD && (c.age_days ?? 0) < PRIORITY_AGE_THRESHOLD;

// Build a recap object per facility (mirrors the Overview aggregation).
export async function computeFacilityRecaps(admin: Admin): Promise<FacilityRecap[]> {
  const [facilities, claimsRaw, issues, payments, billed, auths, census, repricing] =
    await Promise.all([
      pageAll<{ id: string; name: string; short_name: string | null }>(admin, (a) =>
        a.from("facilities").select("id,name,short_name").order("name")
      ),
      pageAll<Claim>(admin, (a) =>
        a
          .from("claims")
          .select(
            "claim_id,facility_id,patient_name,member_id,dos_from,charge_amount,balance,age_days,claim_status"
          )
          .eq("present", true)
      ),
      pageAll<{ facility_id: string | null }>(admin, (a) =>
        a.from("auth_issues").select("facility_id").neq("status", "Completed")
      ),
      pageAll<any>(admin, (a) =>
        a
          .from("payments")
          .select(
            "facility_id,paid_amount,payment_source,period,deposit_date,cpt_description,dos_from,patient_name"
          )
      ).catch(() => []),
      pageAll<any>(admin, (a) =>
        a.from("billed_claims").select("facility_id,total_amount,period")
      ).catch(() => []),
      pageAll<any>(admin, (a) =>
        a
          .from("authorizations")
          .select("facility_id,discharged,discharge_date,next_review_date,created_at")
      ).catch(() => []),
      pageAll<any>(admin, (a) =>
        a
          .from("census")
          .select("facility_id,level_of_care,week_start,gn_rate,patient_name,days")
      ).catch(() => []),
      pageAll<any>(admin, (a) =>
        a.from("repricing").select("facility_id,total_amount,amount_paid,claim_status")
      ).catch(() => []),
    ]);

  const claims = claimsRaw.filter((c) => !isExcludedMember(c.member_id));

  const outlooks = computeOutlooks({
    facilities: facilities.map((f) => ({ id: f.id, name: f.name, short_name: f.short_name })),
    payments,
    billed,
    claims: claims.map((c) => ({
      facility_id: c.facility_id,
      balance: c.balance,
      age_days: c.age_days,
    })),
    auths,
    census,
    repricing,
  });
  const outlookOf = new Map(outlooks.filter((o) => o.facility_id).map((o) => [o.facility_id, o]));

  const byBalance = (a: Claim, b: Claim) => (b.balance ?? 0) - (a.balance ?? 0);

  return facilities.map((f) => {
    const fc = claims.filter((c) => c.facility_id === f.id);
    const charged = fc.reduce((s, c) => s + (c.charge_amount ?? 0), 0);
    const balance = fc.reduce((s, c) => s + (c.balance ?? 0), 0);
    const pri = fc.filter(isPriority);
    const risk = fc.filter(isRisk65);
    return {
      facilityId: f.id,
      name: f.short_name || f.name,
      charged,
      recovered: charged - balance,
      balance,
      pri100Count: pri.length,
      pri100Balance: pri.reduce((s, c) => s + (c.balance ?? 0), 0),
      risk65Count: risk.length,
      risk65Balance: risk.reduce((s, c) => s + (c.balance ?? 0), 0),
      openIssues: issues.filter((i) => i.facility_id === f.id).length,
      outlook: outlookOf.get(f.id) ?? null,
      worst100: pri.sort(byBalance).slice(0, 20),
      worst65: risk.sort(byBalance).slice(0, 20),
    };
  });
}

// Facility id → its login email(s). A facility login is a profile with
// role='facility' whose primary facility_id matches, OR who is granted the
// facility via the assignments table (multi-facility logins). Emails come from
// auth via getUserById (direct lookup, most reliable).
export async function facilityRecipients(admin: Admin): Promise<Map<string, string[]>> {
  const [{ data: profs }, { data: asgs }] = await Promise.all([
    admin.from("profiles").select("id,facility_id").eq("role", "facility"),
    admin.from("assignments").select("profile_id,facility_id"),
  ]);
  const profileIds = new Set((profs ?? []).map((p: { id: string }) => p.id));

  // profile id → email
  const emailOf = new Map<string, string>();
  for (const p of (profs ?? []) as { id: string }[]) {
    try {
      const { data } = await admin.auth.admin.getUserById(p.id);
      if (data?.user?.email) emailOf.set(p.id, data.user.email);
    } catch {
      /* skip */
    }
  }

  // facility id → set of profile ids that can see it
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

// ---- HTML rendering (mirrors the Overview page) ---------------------------

function statTile(label: string, value: string, color: string): string {
  return `<td style="padding:10px 12px;border:1px solid #eee;border-radius:8px;vertical-align:top">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#888">${label}</div>
    <div style="font-size:22px;font-weight:700;color:${color}">${value}</div>
  </td>`;
}

function claimTable(title: string, color: string, rows: Claim[], emptyMsg: string): string {
  const body = rows
    .map(
      (c) => `<tr>
        <td style="padding:4px 8px;border-bottom:1px solid #eee">${c.patient_name || "—"}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right"><b style="color:${color}">${c.age_days ?? 0}d</b></td>
        <td style="padding:4px 8px;border-bottom:1px solid #eee;color:#555">${c.dos_from || "—"}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:600">${money(c.balance)}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #eee;color:#555">${c.claim_status || "—"}</td>
      </tr>`
    )
    .join("");
  return `<h3 style="margin:20px 0 6px;color:${color}">${title}</h3>
    ${
      rows.length
        ? `<table style="border-collapse:collapse;width:100%;font-size:13px">
            <thead><tr style="text-align:left;color:#888">
              <th style="padding:4px 8px">Patient</th>
              <th style="padding:4px 8px;text-align:right">Age</th>
              <th style="padding:4px 8px">DOS</th>
              <th style="padding:4px 8px;text-align:right">Balance</th>
              <th style="padding:4px 8px">Status</th>
            </tr></thead><tbody>${body}</tbody></table>`
        : `<p style="color:#888;margin:0">${emptyMsg}</p>`
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
  const arrow =
    o?.direction === "up" ? "▲" : o?.direction === "down" ? "▼" : o?.direction === "risk" ? "⚠" : "▬";
  const arrowColor =
    o?.direction === "up" ? "#137333" : o?.direction === "down" || o?.direction === "risk" ? "#b00020" : "#666";

  const locRows = (o?.locBilling ?? [])
    .map(
      (l) => `<tr>
        <td style="padding:3px 8px;border-bottom:1px solid #eee">${l.loc}</td>
        <td style="padding:3px 8px;border-bottom:1px solid #eee;text-align:right">${l.curServices}</td>
        <td style="padding:3px 8px;border-bottom:1px solid #eee;text-align:right;color:#888">${l.priorServices}</td>
        <td style="padding:3px 8px;border-bottom:1px solid #eee;text-align:right">${l.curClients}</td>
      </tr>`
    )
    .join("");

  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6">
    <h2 style="margin:0 0 2px">${r.name} — Daily Recap</h2>
    <p style="margin:0 0 16px;color:#555">${nice}</p>

    <table style="border-collapse:separate;border-spacing:6px;width:100%">
      <tr>
        ${statTile("Charged", money(r.charged), "#222")}
        ${statTile("Recovered", money(r.recovered), "#137333")}
        ${statTile("Outstanding", money(r.balance), "#a8730b")}
      </tr>
      <tr>
        ${statTile("100+ Priority", String(r.pri100Count), "#b00020")}
        ${statTile("65–99 Risk", String(r.risk65Count), "#a8730b")}
        ${statTile("Open Auth Issues", String(r.openIssues), "#1a56db")}
      </tr>
    </table>

    ${
      o
        ? `<div style="margin:18px 0;padding:12px 14px;border:1px solid #eee;border-radius:8px;background:#fafafa">
            <div style="font-weight:700;margin-bottom:2px">
              <span style="color:${arrowColor}">${arrow}</span> Money Outlook — ${o.headline}
            </div>
            <div style="color:#444">${o.reason}</div>
            <div style="color:#666;margin-top:6px">
              ${o.curLabel} paid <b>${money(o.paidCur)}</b> vs ${o.priorLabel} <b>${money(o.paidPrior)}</b>${
                o.pct != null ? ` (${o.pct > 0 ? "+" : ""}${o.pct.toFixed(0)}%)` : ""
              }
            </div>
            <div style="color:#666;margin-top:6px">🔮 ${o.forecast}</div>
            ${
              locRows
                ? `<table style="border-collapse:collapse;width:100%;font-size:13px;margin-top:10px">
                    <thead><tr style="text-align:left;color:#888">
                      <th style="padding:3px 8px">Level of care</th>
                      <th style="padding:3px 8px;text-align:right">Services (now)</th>
                      <th style="padding:3px 8px;text-align:right">Prior</th>
                      <th style="padding:3px 8px;text-align:right">Clients</th>
                    </tr></thead><tbody>${locRows}</tbody></table>`
                : ""
            }
          </div>`
        : ""
    }

    ${claimTable(`Priority · 100+ Days (${money(r.pri100Balance)})`, "#b00020", r.worst100, "No claims 100+ days. 🎉")}
    ${claimTable(`Risk · 65–99 Days (${money(r.risk65Balance)})`, "#a8730b", r.worst65, "No claims in the 65–99 day band. 🎉")}

    <hr style="border:none;border-top:1px solid #ddd;margin-top:22px" />
    <p style="font-size:11px;color:#888">Automated daily recap from BC Billing. Contains PHI — handle per HIPAA.</p>
  </div>`;
}
