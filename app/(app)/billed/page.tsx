import { redirect } from "next/navigation";
import { requireProfile, accessibleFacilities } from "@/lib/auth";
import Header from "@/components/Header";
import BilledClient from "@/components/billed/BilledClient";

export default async function BilledPage() {
  const { profile, email } = await requireProfile();
  if (profile.role !== "staff" && profile.role !== "management") redirect("/");

  const facilities = await accessibleFacilities();

  return (
    <>
      <Header profile={profile} email={email} subtitle="Billed" />
      <main className="min-h-0 flex-1 overflow-hidden">
        <BilledClient
          facilities={facilities}
          userId={profile.id}
          isManagement={profile.role === "management"}
        />
      </main>
    </>
  );
}
