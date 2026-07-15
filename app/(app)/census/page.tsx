import { redirect } from "next/navigation";
import { requireProfile, accessibleFacilities } from "@/lib/auth";
import Header from "@/components/Header";
import CensusClient from "@/components/census/CensusClient";

export default async function CensusPage() {
  const { profile, email } = await requireProfile();
  if (profile.role === "pending") redirect("/");
  const facilities = await accessibleFacilities();
  return (
    <>
      <Header profile={profile} email={email} subtitle="Weekly Census" />
      <main className="min-h-0 flex-1 overflow-hidden">
        <CensusClient
          facilities={facilities}
          userId={profile.id}
          canBill={profile.role === "management" || profile.role === "staff"}
        />
      </main>
    </>
  );
}
