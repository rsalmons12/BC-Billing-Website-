import { redirect, notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/page";
import Header from "@/components/Header";
import AgedPayerBubbles, { type AgedPayer } from "@/components/aged/AgedPayerBubbles";
import { arBalance, isExcludedMember, isStaleClaim } from "@/lib/claims";
import { payerBucket } from "@/lib/payer";
import type { Claim } from "@/lib/types";

const AGED_MIN_DAYS = 120;

export default async function AgedFacilityPage({
  params,
}: {
  params: { facilityId: string };
}) {
  const { profile, email } = await requireProfile();
  if (
    profile.role !== "management" &&
    profile.role !== "staff" &&
    profile.role !== "facility"
  ) {
    redirect("/");
  }

  const supabase = createClient();
  const [{ data: fac }, claims] = await Promise.all([
    supabase.from("facilities").select("id,name,short_name").eq("id", params.facilityId).maybeSingle(),
    selectAll<Claim>(
      (f, t) =>
        supabase
          .from("claims")
          .select("claim_id,facility_id,member_id,balance,age_days,claim_status")
          .eq("facility_id", params.facilityId)
          .eq("present", true)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .range(f, t) as any
    ),
  ]);
  if (!fac) notFound(); // no access / unknown facility → RLS returns nothing

  const facilityName = fac.short_name || fac.name || "Facility";

  const agg = new Map<string, { balance: number; lines: number }>();
  for (const c of claims) {
    if (isExcludedMember(c.member_id) || isStaleClaim(c.age_days)) continue;
    if ((c.age_days ?? 0) < AGED_MIN_DAYS) continue;
    const p = payerBucket(c.claim_status);
    const a = agg.get(p) ?? { balance: 0, lines: 0 };
    a.balance += arBalance(c.balance);
    a.lines += 1;
    agg.set(p, a);
  }

  const payers: AgedPayer[] = Array.from(agg.entries())
    .map(([payer, a]) => ({ payer, balance: a.balance, lines: a.lines }))
    .sort((x, y) => y.lines - x.lines);

  return (
    <>
      <Header profile={profile} email={email} subtitle={`120+ Day Claims · ${facilityName}`} />
      <main className="min-h-0 flex-1 overflow-auto">
        <AgedPayerBubbles
          facilityId={params.facilityId}
          facilityName={facilityName}
          payers={payers}
          minDays={AGED_MIN_DAYS}
        />
      </main>
    </>
  );
}
