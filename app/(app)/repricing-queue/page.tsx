import { redirect } from "next/navigation";
import { requireProfile, accessibleFacilities } from "@/lib/auth";
import Header from "@/components/Header";
import RepricingClient from "@/components/repricing/RepricingClient";

// The repricer worklist: every OPEN (needs follow-up) repricing claim across all
// facilities, oldest-touched first so the claims past the 14-day turnaround sit
// at the top. Approved and Denied claims drop out (Denied lives in its bucket).
export default async function RepricingQueuePage() {
  const { profile, email } = await requireProfile();
  if (profile.role === "pending") redirect("/");
  const facilities = await accessibleFacilities();
  return (
    <>
      <Header profile={profile} email={email} subtitle="Repricing Queue" />
      <main className="min-h-0 flex-1 overflow-hidden">
        <RepricingClient
          facilities={facilities}
          userId={profile.id}
          isManagement={profile.role === "management"}
          readOnly={profile.role === "facility"}
          queue
        />
      </main>
    </>
  );
}
