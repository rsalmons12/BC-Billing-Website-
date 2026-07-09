import { redirect } from "next/navigation";
import { requireProfile, accessibleFacilities } from "@/lib/auth";
import Header from "@/components/Header";
import LookupClient from "@/components/lookup/LookupClient";

export default async function LookupPage() {
  const { profile, email } = await requireProfile();
  if (profile.role !== "management") redirect("/");
  const facilities = await accessibleFacilities();
  return (
    <>
      <Header profile={profile} email={email} subtitle="Patient Lookup" />
      <main className="min-h-0 flex-1 overflow-hidden">
        <LookupClient facilities={facilities} />
      </main>
    </>
  );
}
