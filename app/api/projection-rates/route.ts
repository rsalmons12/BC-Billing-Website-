import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createRateAccumulator, type ProjectionRates } from "@/lib/projection";

// Builds the Projected Revenue rate table. Payment history is ~140k rows, so we
// STREAM it one page at a time into an accumulator (never holding the whole table
// in memory — that was OOM-ing the instance) and cache the small result table.
export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Small in-memory cache keyed by facility scope. The rate table is tiny (~1k
// patient entries); payments change on import, not minute to minute, so a few
// minutes of staleness is fine and saves re-scanning 140k rows every page load.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; data: ProjectionRates }>();

const PAGE = 1000;
async function forEachRow<T>(
  make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  onRow: (r: T) => void
) {
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await make(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows) onRow(r);
    if (rows.length < PAGE) break;
  }
}

export async function GET(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!me || !["management", "staff", "facility"].includes(me.role)) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const fid = new URL(request.url).searchParams.get("facility") ?? "all";
  const scoped = fid && fid !== "all";
  // Cache key includes the role so a facility login (RLS-scoped) never reads a
  // management-built "all" entry.
  const key = `${me.role}:${fid}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return NextResponse.json(hit.data);

  const acc = createRateAccumulator();
  try {
    await forEachRow<any>((from, to) => {
      let q = supabase.from("claims").select("patient_name,claim_status,balance").eq("present", true);
      if (scoped) q = q.eq("facility_id", fid);
      return q.range(from, to);
    }, acc.addClaim);
    await forEachRow<any>((from, to) => {
      let q = supabase.from("billed_claims").select("patient_name,total_amount,payer_name");
      if (scoped) q = q.eq("facility_id", fid);
      return q.range(from, to);
    }, acc.addBilled);
    await forEachRow<any>((from, to) => {
      let q = supabase.from("payments").select("patient_name,paid_amount");
      if (scoped) q = q.eq("facility_id", fid);
      return q.range(from, to);
    }, acc.addPayment);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to build rates" },
      { status: 500 }
    );
  }

  const data = acc.finalize();
  cache.set(key, { at: Date.now(), data });
  return NextResponse.json(data);
}
