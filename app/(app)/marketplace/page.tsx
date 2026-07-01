import { redirect } from "next/navigation";
import { requireProfile, accessibleFacilities } from "@/lib/auth";
import Header from "@/components/Header";
import MarketplaceClient from "@/components/marketplace/MarketplaceClient";

export default async function MarketplacePage() {
  const { profile, email } = await requireProfile();
  if (profile.role !== "staff" && profile.role !== "management") redirect("/");

  const facilities = await accessibleFacilities();

  return (
    <>
      <Header profile={profile} email={email} subtitle="Marketplace / Exchange Plans" />
      <main className="min-h-0 flex-1 overflow-hidden">
        <MarketplaceClient
          facilities={facilities}
          isManagement={profile.role === "management"}
        />
      </main>
    </>
  );
}
