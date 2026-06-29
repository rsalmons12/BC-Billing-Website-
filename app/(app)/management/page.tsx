import { redirect } from "next/navigation";
import { requireProfile, accessibleFacilities } from "@/lib/auth";
import Header from "@/components/Header";
import ManagementClient from "@/components/management/ManagementClient";

export default async function ManagementPage() {
  const { profile, email } = await requireProfile();
  if (profile.role !== "management" && profile.role !== "staff") redirect("/");
  const facilities = await accessibleFacilities();
  return (
    <>
      <Header profile={profile} email={email} subtitle="Management Review" />
      <main className="min-h-0 flex-1 overflow-hidden">
        <ManagementClient facilities={facilities} />
      </main>
    </>
  );
}
