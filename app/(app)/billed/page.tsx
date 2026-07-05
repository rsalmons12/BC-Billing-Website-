import { redirect } from "next/navigation";
import { requireProfile, accessibleFacilities } from "@/lib/auth";
import Header from "@/components/Header";
import BilledClient from "@/components/billed/BilledClient";

export default async function BilledPage() {
  const { profile, email } = await requireProfile();
  if (!["staff", "management", "facility"].includes(profile.role)) redirect("/");

  const facilities = await accessibleFacilities();
  // Facility logins see their own billed claims read-only (RLS scopes rows).
  const isFacility = profile.role === "facility";

  return (
    <>
      <Header profile={profile} email={email} subtitle="Billed" />
      <main className="min-h-0 flex-1 overflow-hidden">
        <BilledClient
          facilities={facilities}
          userId={profile.id}
          isManagement={profile.role === "management"}
          readOnly={isFacility}
        />
      </main>
    </>
  );
}
