import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/page";

// Diagnostic ONLY (owner-only). Reports what the Historical Data table actually
// holds right now — total rows, breakdown by year/state, distinct prefixes, and
// a few sample rows — so we can tell whether an import truly found "no new data"
// or the table is emptier/older than expected. Reads only; changes nothing.
export const dynamic = "force-dynamic";

type Row = {
  prefix: string | null;
  state: string | null;
  year: string | null;
  payer: string | null;
  code_used: string | null;
  paid_per_day: number | null;
};

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: me } = await supabase
    .from("profiles")
    .select("role, is_owner")
    .eq("id", user.id)
    .maybeSingle();
  if (me?.role !== "management" || me?.is_owner !== true)
    return NextResponse.json({ error: "Owners only." }, { status: 403 });

  const rows = await selectAll<Row>((f, t) =>
    supabase
      .from("historical_data")
      .select("prefix, state, year, payer, code_used, paid_per_day")
      .order("prefix")
      .range(f, t)
  );

  const byYear: Record<string, number> = {};
  const byState: Record<string, number> = {};
  const prefixes = new Set<string>();
  for (const r of rows) {
    const y = String(r.year ?? "").trim() || "(blank)";
    const s = String(r.state ?? "").trim() || "(blank)";
    byYear[y] = (byYear[y] ?? 0) + 1;
    byState[s] = (byState[s] ?? 0) + 1;
    if (r.prefix) prefixes.add(String(r.prefix).trim().toUpperCase());
  }

  return NextResponse.json({
    total: rows.length,
    distinctPrefixes: prefixes.size,
    byYear,
    byState,
    sample: rows.slice(0, 8),
  });
}
