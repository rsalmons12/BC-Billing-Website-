import { redirect } from "next/navigation";
import { requireProfile, accessibleFacilities } from "@/lib/auth";
import Header from "@/components/Header";
import RepricingClient from "@/components/repricing/RepricingClient";

export default async function RepricingPage() {
  const { profile, email } = await requireProfile();
  if (profile.role !== "management" && profile.role !== "staff") redirect("/");
  const facilities = await accessibleFacilities();
  return (
    <>
      <Header profile={profile} email={email} subtitle="Repricing" />
      <main className="min-h-0 flex-1 overflow-hidden">
        <RepricingClient
          facilities={facilities}
          userId={profile.id}
          isManagement={profile.role === "management"}
        />
      </main>
    </>
  );
}
