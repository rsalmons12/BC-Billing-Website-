import { redirect } from "next/navigation";
import { requireProfile, accessibleFacilities } from "@/lib/auth";
import Header from "@/components/Header";
import ImportClient from "@/components/import/ImportClient";

export default async function ImportPage() {
  const { profile, email } = await requireProfile();
  if (profile.role !== "management") redirect("/");

  const facilities = await accessibleFacilities();

  return (
    <>
      <Header profile={profile} email={email} subtitle="Weekly Import" />
      <main className="min-h-0 flex-1 overflow-auto p-6">
        <ImportClient facilities={facilities} />
      </main>
    </>
  );
}
