import { redirect } from "next/navigation";
import { requireProfile, accessibleFacilities } from "@/lib/auth";
import Header from "@/components/Header";
import RepricingClient from "@/components/repricing/RepricingClient";

// Repricing opens as a facility → payer → claims drill-down (see RepricingClient
// / TrackerModule `drilldown`). This line exists to force a fresh deploy.
export default async function RepricingPage() {
  const { profile, email } = await requireProfile();
  if (profile.role === "pending") redirect("/");
  const facilities = await accessibleFacilities();
  return (
    <>
      <Header profile={profile} email={email} subtitle="Repricing" />
      <main className="min-h-0 flex-1 overflow-hidden">
        <RepricingClient
          facilities={facilities}
          userId={profile.id}
          isManagement={profile.role === "management"}
          readOnly={profile.role === "facility"}
        />
      </main>
    </>
  );
}
