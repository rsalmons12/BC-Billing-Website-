import { redirect } from "next/navigation";
import { requireProfile, accessibleFacilities } from "@/lib/auth";
import Header from "@/components/Header";
import AuthIssuesClient from "@/components/auth/AuthIssuesClient";

export default async function AuthIssuesPage() {
  const { profile, email } = await requireProfile();

  if (profile.role !== "management" && profile.role !== "staff") {
    redirect("/");
  }

  const facilities = await accessibleFacilities();

  return (
    <>
      <Header profile={profile} email={email} subtitle="Auth Issues" />
      <main className="min-h-0 flex-1 overflow-hidden">
        <AuthIssuesClient facilities={facilities} />
      </main>
    </>
  );
}
