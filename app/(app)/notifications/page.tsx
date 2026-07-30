import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import Header from "@/components/Header";
import NotificationsClient from "@/components/notifications/NotificationsClient";

// Lightweight management page for sending/previewing the outgoing emails.
// Deliberately loads no heavy data so it's instant, unlike the Overview.
export default async function NotificationsPage() {
  const { profile, email } = await requireProfile();
  if (profile.role !== "management") redirect("/");

  return (
    <>
      <Header profile={profile} email={email} subtitle="Email Notifications" />
      <main className="min-h-0 flex-1 overflow-auto p-6">
        <NotificationsClient />
      </main>
    </>
  );
}
