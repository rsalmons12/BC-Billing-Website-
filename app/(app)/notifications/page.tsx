import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Header from "@/components/Header";
import NotificationsClient from "@/components/notifications/NotificationsClient";

// Lightweight management page for sending/previewing the outgoing emails.
// Deliberately loads no heavy data so it's instant, unlike the Overview.
export default async function NotificationsPage() {
  const { profile, email } = await requireProfile();
  if (profile.role !== "management") redirect("/");

  // Recent scheduled-job heartbeats, so management can see whether the automatic
  // (cron) emails are actually firing. Empty/absent table is fine — shows "none".
  const supabase = createClient();
  const { data: cronRuns } = await supabase
    .from("cron_log")
    .select("job,ran_at,detail")
    .order("ran_at", { ascending: false })
    .limit(12);

  return (
    <>
      <Header profile={profile} email={email} subtitle="Email Notifications" />
      <main className="min-h-0 flex-1 overflow-auto p-6">
        <NotificationsClient cronRuns={cronRuns ?? []} />
      </main>
    </>
  );
}
