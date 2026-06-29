import { redirect } from "next/navigation";
import { requireProfile, accessibleFacilities } from "@/lib/auth";
import Header from "@/components/Header";
import AuthorizationsClient from "@/components/authorizations/AuthorizationsClient";

export default async function AuthorizationsPage() {
  const { profile, email } = await requireProfile();
  if (profile.role !== "management" && profile.role !== "staff") redirect("/");
  const facilities = await accessibleFacilities();
  return (
    <>
      <Header profile={profile} email={email} subtitle="Authorization" />
      <main className="min-h-0 flex-1 overflow-hidden">
        <AuthorizationsClient
          facilities={facilities}
          userId={profile.id}
          isManagement={profile.role === "management"}
        />
      </main>
    </>
  );
}
