import { redirect } from "next/navigation";
import { requireProfile, accessibleFacilities } from "@/lib/auth";
import Header from "@/components/Header";
import CollectionsClient from "@/components/collections/CollectionsClient";

export default async function CollectionsPage() {
  const { profile, email } = await requireProfile();

  // Management + staff work the board; facility logins get a read-only view of
  // their own facility's claims. Everyone else is bounced.
  if (
    profile.role !== "management" &&
    profile.role !== "staff" &&
    profile.role !== "facility"
  ) {
    redirect("/");
  }

  const facilities = await accessibleFacilities();

  return (
    <>
      <Header profile={profile} email={email} subtitle="Collections" />
      <main className="min-h-0 flex-1 overflow-hidden">
        <CollectionsClient
          facilities={facilities}
          userId={profile.id}
          userName={profile.full_name ?? ""}
          readOnly={profile.role === "facility"}
        />
      </main>
    </>
  );
}
