import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listSquarePayments } from "@/lib/square";

// Owner-only: return recent Square payments so the invoice tracker can show what
// facilities have actually paid. The app has no Square webhook, so this is a
// live read of Square's ListPayments API on demand.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
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

  const url = new URL(request.url);
  const days = Number(url.searchParams.get("days")) || 60;

  const { payments, error } = await listSquarePayments({ days });
  if (error && payments.length === 0)
    return NextResponse.json({ error }, { status: 502 });

  return NextResponse.json({ ok: true, payments, error });
}
