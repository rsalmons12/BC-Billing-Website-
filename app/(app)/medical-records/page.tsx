import { redirect } from "next/navigation";
import { requireProfile, accessibleFacilities } from "@/lib/auth";
import Header from "@/components/Header";
import MedicalRecordsClient from "@/components/medrecords/MedicalRecordsClient";

export default async function MedicalRecordsPage() {
  const { profile, email } = await requireProfile();
  if (profile.role !== "management" && profile.role !== "staff") redirect("/");
  const facilities = await accessibleFacilities();
  return (
    <>
      <Header profile={profile} email={email} subtitle="Medical Records" />
      <main className="min-h-0 flex-1 overflow-hidden">
        <MedicalRecordsClient
          facilities={facilities}
          userId={profile.id}
          isManagement={profile.role === "management"}
        />
      </main>
    </>
  );
}
