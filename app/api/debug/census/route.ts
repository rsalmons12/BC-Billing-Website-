import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normFacility } from "@/lib/import/parse";

// Management-only diagnostic for the census reimbursement mix. Shows, per
// facility, the census weeks on file, which week is "current" (newest), and the
// mix computed two ways (card vs Census-page rule) so a mismatch is visible.
// Patient identities are reduced to initials — no full names leave here.
export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

const norm = (s: unknown) =>
  String(s ?? "").toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");

function locFam(loc: unknown): "PHP" | "IOP" | "OP" | null {
  const u = String(loc ?? "").toUpperCase();
  if (/\bIOP\b/.test(u) || /H0015|S9480/.test(u)) return "IOP";
  if (/\bPHP\b/.test(u) || /PARTIAL/.test(u) || /S0201|H0035/.test(u)) return "PHP";
  if (/\bOP\b/.test(u) || /OUTPATIENT/.test(u) || /90853/.test(u)) return "OP";
  return null;
}
const ms = (v: unknown) => {
  const t = Date.parse(String(v ?? ""));
  return isNaN(t) ? 0 : t;
};
function initials(name: unknown): string {
  const s = String(name ?? "").trim();
  if (!s) return "—";
  let f = "", l = "";
  if (s.includes(",")) {
    const [a, b] = s.split(",").map((x) => x.trim());
    l = a ?? ""; f = b ?? "";
  } else {
    const p = s.split(/\s+/).filter(Boolean);
    f = p[0] ?? ""; l = p.length > 1 ? p[p.length - 1] : "";
  }
  return (`${f[0] ?? ""}${l[0] ?? ""}`.toUpperCase()) || (s[0] ?? "").toUpperCase();
}

// Latest-service-day payment sum for a patient, matched by member id and/or name.
function resolvedPaid(
  pays: { member_id: string | null; patient_name: string | null; dos_from: string | null; paid_amount: number | null }[],
  cid: string,
  cnm: string,
  mode: "card" | "page"
): { paid: number; matched: number } {
  const theirs = pays.filter((p) => {
    if ((p.paid_amount ?? 0) <= 0) return false;
    const pid = String(p.member_id ?? "").trim().toLowerCase();
    if (mode === "card" && cid && pid && cid === pid) return true;
    return cnm !== "" && norm(p.patient_name) === cnm;
  });
  if (theirs.length === 0) return { paid: 0, matched: 0 };
  let latest = 0;
  for (const p of theirs) latest = Math.max(latest, ms(p.dos_from));
  const paid = theirs.filter((p) => ms(p.dos_from) === latest).reduce((s, p) => s + (p.paid_amount ?? 0), 0);
  return { paid, matched: theirs.length };
}

export async function GET(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "management") return NextResponse.json({ error: "Management only" }, { status: 403 });

  const admin = createAdminClient();
  const filter = new URL(request.url).searchParams.get("facility")?.toLowerCase() ?? "";

  const { data: facs } = await admin.from("facilities").select("id,name,short_name");
  const facilities = (facs as any[]) ?? [];
  const pickFor = (f: any) => {
    const base = normFacility(f.name || f.short_name || "");
    const linked = facilities.filter((x) => {
      const n = normFacility(x.name || x.short_name || "");
      return n && base && (n === base || n.includes(base) || base.includes(n));
    });
    return linked;
  };

  const { data: censusAll } = await admin
    .from("census")
    .select("facility_id,level_of_care,week_start,patient_name,member_id,paid_amount");
  const { data: paysAll } = await admin
    .from("payments")
    .select("facility_id,member_id,patient_name,dos_from,paid_amount");
  const census = (censusAll as any[]) ?? [];
  const pays = (paysAll as any[]) ?? [];

  const targets = facilities.filter(
    (f) => !filter || String(f.name || "").toLowerCase().includes(filter) || String(f.short_name || "").toLowerCase().includes(filter)
  );

  const out = targets
    .map((f) => {
      const linked = pickFor(f);
      const linkedIds = new Set(linked.map((x) => x.id));
      const fCensus = census.filter((c) => c.facility_id === f.id && c.week_start);
      if (fCensus.length === 0) return null;
      const weeks = Array.from(new Set(fCensus.map((c) => c.week_start))).sort();
      const currentWeek = weeks[weeks.length - 1];
      const lastCompleted = weeks[weeks.length - 2] ?? weeks[weeks.length - 1];
      const cur = fCensus.filter((c) => c.week_start === currentWeek);
      // payments in the linked facility set
      const linkedPays = pays.filter((p) => linkedIds.has(p.facility_id));
      const mainPays = pays.filter((p) => p.facility_id === f.id);

      const mkMix = () => ({ total: 0, over1000: 0, over2000: 0, under800: 0 });
      const cardMix = mkMix();
      const pageMix = mkMix();
      const rows = cur.map((c) => {
        const cid = String(c.member_id ?? "").trim().toLowerCase();
        const cnm = norm(c.patient_name);
        const manual = (c.paid_amount ?? 0) > 0 ? Number(c.paid_amount) : 0;
        const cardR = manual > 0 ? { paid: manual, matched: -1 } : resolvedPaid(linkedPays, cid, cnm, "card");
        // Census page: name-only match, but note it also pulls linked facilities.
        const pageR = manual > 0 ? { paid: manual, matched: -1 } : resolvedPaid(linkedPays, cid, cnm, "page");
        const bump = (m: any, paid: number) => {
          m.total += 1;
          if (paid > 2000) m.over2000 += 1;
          if (paid > 1000) m.over1000 += 1;
          if (paid < 800) m.under800 += 1;
        };
        bump(cardMix, cardR.paid);
        bump(pageMix, pageR.paid);
        return {
          who: initials(c.patient_name),
          loc: locFam(c.level_of_care),
          manual: manual || null,
          cardPaid: cardR.paid,
          pagePaid: pageR.paid,
          differs: cardR.paid !== pageR.paid,
        };
      });
      const pct = (n: number, t: number) => (t > 0 ? Math.round((n / t) * 100) : 0);
      const fmtMix = (m: any) => ({
        clients: m.total,
        over1000: `${pct(m.over1000, m.total)}% (${m.over1000})`,
        over2000: `${pct(m.over2000, m.total)}% (${m.over2000})`,
        under800: `${pct(m.under800, m.total)}% (${m.under800})`,
      });
      return {
        facility: f.short_name || f.name,
        linkedRecords: linked.map((x) => x.short_name || x.name),
        weeks,
        currentWeek,
        lastCompletedWeek: lastCompleted,
        paymentsInMainRecord: mainPays.length,
        paymentsInLinkedRecords: linkedPays.length,
        cardMix: fmtMix(cardMix),
        pageMix_nameMatch: fmtMix(pageMix),
        patients: rows,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ count: out.length, facilities: out }, { status: 200 });
}
