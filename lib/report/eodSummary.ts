import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// End-of-day summary helpers. Recipients are resolved from the accounts marked
// "management" (their login emails) — nothing is preset. Uses the service-role
// (admin) client so it can read every collector's production and the auth
// emails without a user session (e.g. from the 5 PM cron).
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
type Admin = SupabaseClient<any, any, any>;

export const FROM_EMAIL =
  process.env.MESSAGES_FROM_EMAIL || "BC Billing <collections@bcbilling.cloud>";

// Today's date in US Eastern (YYYY-MM-DD). Work is stamped with the collector's
// local (Eastern) date, so the summary must match on Eastern — not the server's
// UTC date, which is a day ahead in the evening.
export function easternToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// Map of user id → login email (all auth users).
export async function usersEmailMap(admin: Admin): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    const users = data?.users ?? [];
    if (error || users.length === 0) break;
    for (const u of users) if (u.email) map.set(u.id, u.email);
    if (users.length < 1000) break;
  }
  return map;
}

// Login emails of everyone whose profile role is "management", plus a small
// diagnostic so a caller can tell "nobody is marked management" apart from
// "they're marked, but their emails couldn't be read".
export async function managementEmailsDiag(
  admin: Admin
): Promise<{ emails: string[]; mgmtCount: number }> {
  const { data: mgmt } = await admin.from("profiles").select("id").eq("role", "management");
  const ids = (mgmt ?? []).map((m: { id: string }) => m.id);
  if (ids.length === 0) return { emails: [], mgmtCount: 0 };
  // Look each management user up directly (more reliable than paging the whole
  // user list); fall back to the full map if a direct lookup comes back empty.
  const emails: string[] = [];
  for (const id of ids) {
    try {
      const { data } = await admin.auth.admin.getUserById(id);
      const e = data?.user?.email;
      if (e) emails.push(e);
    } catch {
      /* try the map fallback below */
    }
  }
  if (emails.length === 0) {
    const map = await usersEmailMap(admin);
    for (const id of ids) {
      const e = map.get(id);
      if (e) emails.push(e);
    }
  }
  return { emails: Array.from(new Set(emails)), mgmtCount: ids.length };
}

export async function managementEmails(admin: Admin): Promise<string[]> {
  return (await managementEmailsDiag(admin)).emails;
}

export interface CollectorSummary {
  collectorId: string;
  name: string;
  worked: number;
  target: number | null;
  balance: number;
  risk65: number;
  byFac: [string, number][];
  rows: { patient: string; fac: string; age: number; balance: number; status: string }[];
}

// A collector's production summary for one day (YYYY-MM-DD).
export async function collectorSummary(
  admin: Admin,
  collectorId: string,
  date: string,
  facName: (id: string | null) => string,
  emailOf?: Map<string, string>
): Promise<CollectorSummary> {
  const { data: prof } = await admin
    .from("profiles")
    .select("full_name,initials,daily_target")
    .eq("id", collectorId)
    .maybeSingle();
  // Never show a generic "Collector" — fall back to the login email when the
  // profile has no name set.
  const name =
    prof?.full_name?.trim() ||
    prof?.initials?.trim() ||
    emailOf?.get(collectorId) ||
    "Collector";

  // Claims worked today = the Queue's production log UNION claim_work rows this
  // person marked worked today (captures work done from Collections too, which
  // doesn't write the production log).
  const [{ data: prod }, { data: cw }] = await Promise.all([
    admin
      .from("production_log")
      .select("claim_id")
      .eq("collector_id", collectorId)
      .eq("worked_on", date),
    admin
      .from("claim_work")
      .select("claim_id")
      .eq("date_worked", date)
      .eq("updated_by", collectorId),
  ]);
  const claimIds = Array.from(
    new Set([
      ...(prod ?? []).map((p: { claim_id: string }) => p.claim_id),
      ...(cw ?? []).map((c: { claim_id: string }) => c.claim_id),
    ])
  );

  type C = {
    facility_id: string | null;
    patient_name: string | null;
    balance: number | null;
    age_days: number | null;
    claim_status: string | null;
  };
  const claims: C[] = [];
  for (let i = 0; i < claimIds.length; i += 500) {
    const { data } = await admin
      .from("claims")
      .select("facility_id,patient_name,balance,age_days,claim_status")
      .in("claim_id", claimIds.slice(i, i + 500));
    for (const c of (data as C[]) ?? []) claims.push(c);
  }

  const byFacMap = new Map<string, number>();
  for (const c of claims) {
    const f = facName(c.facility_id);
    byFacMap.set(f, (byFacMap.get(f) ?? 0) + 1);
  }
  return {
    collectorId,
    name,
    worked: claims.length,
    target: prof?.daily_target ?? null,
    balance: claims.reduce((s, c) => s + (c.balance ?? 0), 0),
    risk65: claims.filter((c) => (c.age_days ?? 0) > 65).length,
    byFac: Array.from(byFacMap.entries()).sort((a, b) => b[1] - a[1]),
    rows: claims
      .sort((a, b) => (b.age_days ?? 0) - (a.age_days ?? 0))
      .slice(0, 40)
      .map((c) => ({
        patient: c.patient_name || "—",
        fac: facName(c.facility_id),
        age: c.age_days ?? 0,
        balance: c.balance ?? 0,
        status: c.claim_status || "",
      })),
  };
}

// Everyone who worked today — from the Queue production log AND from claims
// marked worked in any tab (claim_work.updated_by).
export async function collectorsWhoWorked(admin: Admin, date: string): Promise<string[]> {
  const [{ data: prod }, { data: cw }] = await Promise.all([
    admin.from("production_log").select("collector_id").eq("worked_on", date),
    admin.from("claim_work").select("updated_by").eq("date_worked", date),
  ]);
  return Array.from(
    new Set(
      [
        ...(prod ?? []).map((p: { collector_id: string }) => p.collector_id),
        ...(cw ?? []).map((c: { updated_by: string | null }) => c.updated_by),
      ].filter(Boolean) as string[]
    )
  );
}

// Full team digest for one day: a summary per collector who worked, sorted by
// most worked first. Shared by the manual "send now" button and the 5 PM cron.
export async function buildTeamDigest(admin: Admin, date: string): Promise<CollectorSummary[]> {
  const ids = await collectorsWhoWorked(admin, date);
  if (ids.length === 0) return [];
  const facName = await facilityNamer(admin);
  const emailOf = await usersEmailMap(admin);
  const summaries: CollectorSummary[] = [];
  for (const id of ids) summaries.push(await collectorSummary(admin, id, date, facName, emailOf));
  summaries.sort((a, b) => b.worked - a.worked);
  return summaries;
}

// Build a facility id → name lookup from the facilities table.
export async function facilityNamer(admin: Admin): Promise<(id: string | null) => string> {
  const { data } = await admin.from("facilities").select("id,name,short_name");
  const rows = (data ?? []) as { id: string; name: string; short_name: string | null }[];
  return (id) => {
    const f = rows.find((x) => x.id === id);
    return f?.short_name || f?.name || "—";
  };
}

function sectionHtml(s: CollectorSummary): string {
  const facLines = s.byFac.map(([f, n]) => `${f}: <b>${n}</b>`).join(" · ");
  const rows = s.rows
    .map(
      (r) =>
        `<tr>
          <td style="padding:3px 8px;border-bottom:1px solid #eee">${r.patient}</td>
          <td style="padding:3px 8px;border-bottom:1px solid #eee;color:#555">${r.fac}</td>
          <td style="padding:3px 8px;border-bottom:1px solid #eee;text-align:right">${r.age}d</td>
          <td style="padding:3px 8px;border-bottom:1px solid #eee;text-align:right">${money(r.balance)}</td>
          <td style="padding:3px 8px;border-bottom:1px solid #eee;color:#555">${r.status}</td>
        </tr>`
    )
    .join("");
  return `<div style="margin:0 0 22px">
    <h3 style="margin:0 0 6px">${s.name}</h3>
    <div style="margin-bottom:8px;color:#333">
      <b>${s.worked}</b> worked${s.target != null ? ` <span style="color:#888">/ ${s.target} target</span>` : ""}
      &nbsp;·&nbsp; <b>${s.risk65}</b> risk 65+ &nbsp;·&nbsp; <b>${money(s.balance)}</b> balance worked
    </div>
    ${facLines ? `<div style="color:#555;margin-bottom:8px">${facLines}</div>` : ""}
    ${
      rows
        ? `<table style="border-collapse:collapse;width:100%;font-size:13px">
             <thead><tr style="text-align:left;color:#888">
               <th style="padding:3px 8px">Patient</th><th style="padding:3px 8px">Facility</th>
               <th style="padding:3px 8px;text-align:right">Age</th><th style="padding:3px 8px;text-align:right">Balance</th>
               <th style="padding:3px 8px">Status</th>
             </tr></thead><tbody>${rows}</tbody></table>`
        : `<p style="color:#888;margin:0">No claims logged as worked.</p>`
    }
  </div>`;
}

export function renderDigest(summaries: CollectorSummary[], date: string): string {
  const nice = new Date(date + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const totWorked = summaries.reduce((s, c) => s + c.worked, 0);
  const totBal = summaries.reduce((s, c) => s + c.balance, 0);
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6">
    <h2 style="margin:0 0 2px">End-of-Day Production — ${nice}</h2>
    <p style="margin:0 0 18px;color:#555">${summaries.length} collector${
      summaries.length === 1 ? "" : "s"
    } · <b>${totWorked}</b> claims worked · <b>${money(totBal)}</b> balance</p>
    ${summaries.map(sectionHtml).join("")}
    <hr style="border:none;border-top:1px solid #ddd" />
    <p style="font-size:11px;color:#888">Automated end-of-day summary from BC Billing. Contains PHI — handle per HIPAA.</p>
  </div>`;
}

export async function sendResend(to: string[], subject: string, html: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY missing");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
