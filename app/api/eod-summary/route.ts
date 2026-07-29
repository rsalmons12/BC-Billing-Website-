import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/page";

// Emails an end-of-day production summary for a collector to management.
// The recipient(s) are chosen in the app at send time (body.to) — not preset.
// Env only:
//   RESEND_API_KEY      – the Resend key (already used for facility messages)
//   MESSAGES_FROM_EMAIL – optional "from" (defaults to collections@bcbilling.cloud)
//   EOD_SUMMARY_TO      – optional fallback recipients if none entered
const FROM = process.env.MESSAGES_FROM_EMAIL || "BC Billing <collections@bcbilling.cloud>";
const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!process.env.RESEND_API_KEY)
    return NextResponse.json({ error: "Email is not configured (RESEND_API_KEY missing)." }, { status: 503 });

  // Recipients: request override (management) → env list.
  let body: { collectorId?: string; to?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body is fine */
  }
  const recipients = (body.to || process.env.EOD_SUMMARY_TO || "")
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter((e) => e.includes("@"));
  if (recipients.length === 0)
    return NextResponse.json(
      { error: "No recipient set. Add EOD_SUMMARY_TO in the server env (comma-separated emails)." },
      { status: 400 }
    );

  // Whose day: the caller, unless management asked for a specific collector.
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const collectorId =
    me?.role === "management" && body.collectorId ? body.collectorId : user.id;

  const { data: collector } = await supabase
    .from("profiles")
    .select("full_name, initials, daily_target")
    .eq("id", collectorId)
    .maybeSingle();
  const name = collector?.full_name?.trim() || collector?.initials?.trim() || "Collector";
  const target = collector?.daily_target ?? null;

  const today = new Date().toISOString().slice(0, 10);

  // What they worked today (production log → claim details).
  const prod = await selectAll<{ claim_id: string; facility_id: string | null }>((f, t) =>
    supabase
      .from("production_log")
      .select("claim_id,facility_id")
      .eq("collector_id", collectorId)
      .eq("worked_on", today)
      .range(f, t)
  ).catch(() => [] as { claim_id: string; facility_id: string | null }[]);

  const claimIds = Array.from(new Set(prod.map((p) => p.claim_id)));
  type ClaimLite = {
    claim_id: string;
    facility_id: string | null;
    patient_name: string | null;
    balance: number | null;
    age_days: number | null;
    claim_status: string | null;
  };
  const claims: ClaimLite[] = [];
  for (let i = 0; i < claimIds.length; i += 500) {
    const { data } = await supabase
      .from("claims")
      .select("claim_id,facility_id,patient_name,balance,age_days,claim_status")
      .in("claim_id", claimIds.slice(i, i + 500));
    for (const c of (data as ClaimLite[]) ?? []) claims.push(c);
  }

  const { data: facRows } = await supabase.from("facilities").select("id,name,short_name");
  const facName = (id: string | null) => {
    const f = (facRows ?? []).find((x) => x.id === id);
    return f?.short_name || f?.name || "—";
  };

  const worked = claims.length;
  const balance = claims.reduce((s, c) => s + (c.balance ?? 0), 0);
  const risk65 = claims.filter((c) => (c.age_days ?? 0) > 65).length;
  const byFac = new Map<string, number>();
  for (const c of claims) byFac.set(facName(c.facility_id), (byFac.get(facName(c.facility_id)) ?? 0) + 1);
  const facLines = Array.from(byFac.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([f, n]) => `<li>${f}: <b>${n}</b></li>`)
    .join("");

  const rowsHtml = claims
    .sort((a, b) => (b.age_days ?? 0) - (a.age_days ?? 0))
    .slice(0, 50)
    .map(
      (c) =>
        `<tr>
          <td style="padding:4px 8px;border-bottom:1px solid #eee">${c.patient_name || "—"}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;color:#555">${facName(c.facility_id)}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${c.age_days ?? 0}d</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${money(c.balance ?? 0)}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;color:#555">${c.claim_status || ""}</td>
        </tr>`
    )
    .join("");

  const niceDate = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6">
    <h2 style="margin:0 0 4px">End-of-Day Summary — ${name}</h2>
    <p style="margin:0 0 16px;color:#555">${niceDate}</p>
    <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:16px">
      <div><div style="font-size:12px;color:#888">Claims worked</div><div style="font-size:22px;font-weight:bold">${worked}${
        target != null ? ` <span style="font-size:13px;color:#888">/ ${target} target</span>` : ""
      }</div></div>
      <div><div style="font-size:12px;color:#888">65+ risk cleared</div><div style="font-size:22px;font-weight:bold">${risk65}</div></div>
      <div><div style="font-size:12px;color:#888">Balance worked</div><div style="font-size:22px;font-weight:bold">${money(balance)}</div></div>
    </div>
    ${facLines ? `<div style="margin-bottom:16px"><b>By facility</b><ul style="margin:6px 0">${facLines}</ul></div>` : ""}
    ${
      rowsHtml
        ? `<table style="border-collapse:collapse;width:100%;font-size:13px">
            <thead><tr style="text-align:left;color:#888">
              <th style="padding:4px 8px">Patient</th><th style="padding:4px 8px">Facility</th>
              <th style="padding:4px 8px;text-align:right">Age</th><th style="padding:4px 8px;text-align:right">Balance</th>
              <th style="padding:4px 8px">Status</th>
            </tr></thead><tbody>${rowsHtml}</tbody></table>${
              claims.length > 50 ? `<p style="color:#888;font-size:12px">…and ${claims.length - 50} more.</p>` : ""
            }`
        : `<p style="color:#888">No claims were logged as worked today.</p>`
    }
    <hr style="margin-top:16px;border:none;border-top:1px solid #ddd" />
    <p style="font-size:11px;color:#888">Automated end-of-day summary from BC Billing. Contains PHI — handle per HIPAA.</p>
  </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: recipients,
      subject: `End-of-Day — ${name} · ${worked} worked · ${money(balance)}`,
      html,
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    return NextResponse.json({ error: `Email failed: ${detail.slice(0, 300)}` }, { status: 502 });
  }
  return NextResponse.json({ ok: true, worked, balance });
}
