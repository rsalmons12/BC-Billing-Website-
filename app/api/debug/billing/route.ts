import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/supabase/page";
import { periodOf } from "@/lib/import/parseTrackers";
import { normFacility } from "@/lib/import/parse";

// Management-only diagnostic for the recap's "Billed this month" number. Shows,
// per facility record (and its name-linked siblings), billed totals grouped by
// the stored `period` tag AND by the entered-date month — so a month reading $0
// can be traced to (a) billing filed under a sibling record, or (b) a period tag
// that doesn't match the entry month. No PHI — totals and counts only.
export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "management") return NextResponse.json({ error: "Management only" }, { status: 403 });

  const admin = createAdminClient();
  const filter = new URL(request.url).searchParams.get("facility")?.toLowerCase() ?? "";

  const { data: facs } = await admin.from("facilities").select("id,name,short_name");
  const facilities = ((facs as any[]) ?? []);
  const nameOf = (id: string) => {
    const f = facilities.find((x) => x.id === id);
    return f ? f.short_name || f.name : `? ${String(id).slice(0, 8)}`;
  };

  const targets = facilities.filter(
    (f) =>
      !filter ||
      String(f.name || "").toLowerCase().includes(filter) ||
      String(f.short_name || "").toLowerCase().includes(filter)
  );

  // Pull all billed rows once (facility_id, period, entered_date, total_amount).
  const billed = await selectAll<{
    facility_id: string | null;
    period: string | null;
    entered_date: string | null;
    total_amount: number | null;
  }>((from, to) =>
    admin.from("billed_claims").select("facility_id,period,entered_date,total_amount").range(from, to)
  ).catch(() => []);

  const money0 = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  const out = targets.map((f) => {
    // Name-linked sibling records (same logic the census/payment fix uses).
    const base = normFacility(f.name || f.short_name || "");
    const linked = facilities.filter((x) => {
      const n = normFacility(x.name || x.short_name || "");
      return n && base && (n === base || n.includes(base) || base.includes(n));
    });
    const linkedIds = new Set(linked.map((x) => x.id));

    // Rows under THIS record only, and under the whole linked set.
    const mine = billed.filter((b) => b.facility_id === f.id);
    const linkedRows = billed.filter((b) => linkedIds.has(b.facility_id ?? ""));

    const byPeriod = new Map<string, { count: number; total: number }>();
    const byEntered = new Map<string, { count: number; total: number }>();
    const bump = (m: Map<string, { count: number; total: number }>, key: string, amt: number) => {
      const cur = m.get(key) ?? { count: 0, total: 0 };
      cur.count += 1;
      cur.total += amt;
      m.set(key, cur);
    };
    for (const b of linkedRows) {
      const amt = Number(b.total_amount) || 0;
      bump(byPeriod, String(b.period || "(none)"), amt);
      bump(byEntered, periodOf(b.entered_date ?? "") || "(unparsed)", amt);
    }
    const fmt = (m: Map<string, { count: number; total: number }>) =>
      Array.from(m.entries())
        .sort((a, b) => b[0].localeCompare(a[0]))
        .slice(0, 8)
        .map(([k, v]) => ({ month: k, claims: v.count, billed: money0(v.total) }));

    return {
      facility: f.short_name || f.name,
      linkedRecords: linked.map((x) => ({ name: x.short_name || x.name, billedRows: billed.filter((b) => b.facility_id === x.id).length })),
      rowsUnderThisRecord: mine.length,
      rowsUnderLinkedSet: linkedRows.length,
      // The recap's "Billed <month>" uses period first, else entered-date month.
      billedByPeriodTag: fmt(byPeriod),
      billedByEnteredMonth: fmt(byEntered),
    };
  });

  return NextResponse.json({ asOf: new Date().toISOString(), facilities: out });
}
