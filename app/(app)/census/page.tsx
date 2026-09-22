import { redirect } from "next/navigation";
import { requireProfile, accessibleFacilities } from "@/lib/auth";
import Header from "@/components/Header";
import CensusClient from "@/components/census/CensusClient";
import CensusTextActions from "@/components/census/CensusTextActions";
import { censusImageToken } from "@/lib/report/censusImageToken";

export default async function CensusPage() {
  const { profile, email } = await requireProfile();
  if (profile.role === "pending") redirect("/");
  const facilities = await accessibleFacilities();
  return (
    <>
      <Header profile={profile} email={email} subtitle="Weekly Census" />
      {profile.role === "management" && (
        <CensusTextActions
          facilities={facilities.map((f) => ({
            id: f.id,
            label: f.short_name || f.name,
            img: `/api/census-image?f=${f.id}&t=${censusImageToken(f.id)}`,
          }))}
        />
      )}
      <main className="min-h-0 flex-1 overflow-auto md:overflow-hidden">
        <CensusClient
          facilities={facilities}
          userId={profile.id}
          canBill={profile.role === "management" || profile.role === "staff"}
        />
      </main>
    </>
  );
}
