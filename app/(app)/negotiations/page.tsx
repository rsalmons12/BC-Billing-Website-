import { redirect } from "next/navigation";
import { requireProfile, accessibleFacilities } from "@/lib/auth";
import Header from "@/components/Header";
import NegotiationsClient from "@/components/negotiations/NegotiationsClient";

export default async function NegotiationsPage() {
  const { profile, email } = await requireProfile();
  if (profile.role === "pending") redirect("/");
  const facilities = await accessibleFacilities();
  return (
    <>
      <Header profile={profile} email={email} subtitle="Negotiations" />
      <main className="min-h-0 flex-1 overflow-hidden">
        <NegotiationsClient
          facilities={facilities}
          userId={profile.id}
          isManagement={profile.role === "management"}
          readOnly={profile.role === "facility"}
        />
      </main>
    </>
  );
}
