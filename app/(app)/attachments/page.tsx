import { redirect } from "next/navigation";
import { requireProfile, accessibleFacilities } from "@/lib/auth";
import Header from "@/components/Header";
import AttachmentsClient from "@/components/attachments/AttachmentsClient";

export default async function AttachmentsPage() {
  const { profile, email } = await requireProfile();
  if (profile.role !== "staff" && profile.role !== "management") redirect("/");

  const facilities = await accessibleFacilities();

  return (
    <>
      <Header profile={profile} email={email} subtitle="Attachments" />
      <main className="min-h-0 flex-1 overflow-hidden">
        <AttachmentsClient
          facilities={facilities}
          userId={profile.id}
          isManagement={profile.role === "management"}
        />
      </main>
    </>
  );
}
