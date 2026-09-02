import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/page";
import Header from "@/components/Header";
import AgedBubbles, { type AgedFacility } from "@/components/aged/AgedBubbles";
import { arBalance, isExcludedMember, isStaleClaim, isDemoFacility, isExcludedFacility } from "@/lib/claims";
import type { Claim, Facility } from "@/lib/types";

// Claims sitting this many days or longer are the aged bucket we surface here.
const AGED_MIN_DAYS = 120;

export default async function AgedPage() {
  const { profile, email } = await requireProfile();
  if (
    profile.role !== "management" &&
    profile.role !== "staff" &&
    profile.role !== "facility"
  ) {
    redirect("/");
  }

  const supabase = createClient();
  const [{ data: facData }, claims] = await Promise.all([
    supabase.from("facilities").select("*").order("name"),
    selectAll<Claim>(
      (f, t) =>
        supabase
          .from("claims")
          .select("claim_id,facility_id,member_id,balance,age_days")
          .eq("present", true)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .range(f, t) as any
    ),
  ]);

  const facilities = (facData as Facility[]) ?? [];
  // Management/staff never see the demo facility in real reporting; a facility
  // login only ever sees its own (RLS already scopes its claims).
  const isManagementView = profile.role === "management" || profile.role === "staff";
  const nameById = new Map(facilities.map((f) => [f.id, f]));

  const agg = new Map<string, { balance: number; lines: number }>();
  for (const c of claims) {
    if (!c.facility_id) continue;
    if (isExcludedMember(c.member_id) || isStaleClaim(c.age_days)) continue;
    if ((c.age_days ?? 0) < AGED_MIN_DAYS) continue;
    const fac = nameById.get(c.facility_id);
    // Hidden facilities (Kingsway, Renewed) are excluded for everyone.
    if (fac && (isExcludedFacility(fac.name) || isExcludedFacility(fac.short_name))) continue;
    if (isManagementView && fac && (isDemoFacility(fac.name) || isDemoFacility(fac.short_name)))
      continue;
    const a = agg.get(c.facility_id) ?? { balance: 0, lines: 0 };
    a.balance += arBalance(c.balance);
    a.lines += 1;
    agg.set(c.facility_id, a);
  }

  const items: AgedFacility[] = Array.from(agg.entries())
    .map(([facilityId, a]) => ({
      facilityId,
      name: nameById.get(facilityId)?.short_name || nameById.get(facilityId)?.name || "Facility",
      balance: a.balance,
      lines: a.lines,
    }))
    .sort((x, y) => y.balance - x.balance);

  return (
    <>
      <Header profile={profile} email={email} subtitle="120+ Day Claims" />
      <main className="min-h-0 flex-1 overflow-auto">
        <AgedBubbles items={items} minDays={AGED_MIN_DAYS} />
      </main>
    </>
  );
}
