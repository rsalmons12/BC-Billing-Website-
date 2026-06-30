import { redirect } from "next/navigation";
import { requireProfile, accessibleFacilities } from "@/lib/auth";
import Header from "@/components/Header";
import MessagesClient from "@/components/messages/MessagesClient";

export default async function MessagesPage() {
  const { profile, email } = await requireProfile();
  if (profile.role === "pending") redirect("/");

  const facilities = await accessibleFacilities();

  return (
    <>
      <Header profile={profile} email={email} subtitle="Messages" />
      <main className="min-h-0 flex-1 overflow-hidden">
        <MessagesClient
          facilities={facilities}
          canSend={profile.role === "management" || profile.role === "staff"}
        />
      </main>
    </>
  );
}
