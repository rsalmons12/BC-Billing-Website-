import { redirect } from "next/navigation";
import { requireProfile, accessibleFacilities } from "@/lib/auth";
import Header from "@/components/Header";
import AdjustmentsClient from "@/components/adjustments/AdjustmentsClient";

export default async function AdjustmentsPage() {
  const { profile, email } = await requireProfile();
  if (profile.role !== "staff" && profile.role !== "management") redirect("/");

  const facilities = await accessibleFacilities();

  return (
    <>
      <Header profile={profile} email={email} subtitle="Adjustments" />
      <main className="min-h-0 flex-1 overflow-hidden">
        <AdjustmentsClient
          facilities={facilities}
          isManagement={profile.role === "management"}
        />
      </main>
    </>
  );
}
