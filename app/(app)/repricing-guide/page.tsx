import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import Header from "@/components/Header";
import RepricingGuideClient from "@/components/repricing/RepricingGuideClient";

// General repricing process / vendor notes (Data iSight, Zelis, GCS). Read by
// everyone who can reach it; edited by management.
export default async function RepricingGuidePage() {
  const { profile, email } = await requireProfile();
  if (profile.role === "pending") redirect("/");
  return (
    <>
      <Header profile={profile} email={email} subtitle="Repricing Guide" />
      <main className="min-h-0 flex-1 overflow-auto">
        <RepricingGuideClient canEdit={profile.role === "management"} userId={profile.id} />
      </main>
    </>
  );
}
