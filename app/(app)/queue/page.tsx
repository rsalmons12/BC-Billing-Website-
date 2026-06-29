import { redirect } from "next/navigation";
import { requireProfile, accessibleFacilities } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Header from "@/components/Header";
import QueueClient from "@/components/queue/QueueClient";
import type { Profile } from "@/lib/types";

export default async function QueuePage() {
  const { profile, email } = await requireProfile();
  if (profile.role !== "staff" && profile.role !== "management") redirect("/");

  const facilities = await accessibleFacilities();

  // Management can view any collector's queue.
  let collectors: Profile[] = [];
  if (profile.role === "management") {
    const supabase = createClient();
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("role", "staff")
      .order("full_name");
    collectors = (data as Profile[]) ?? [];
  }

  return (
    <>
      <Header profile={profile} email={email} subtitle="My Queue" />
      <main className="min-h-0 flex-1 overflow-hidden">
        <QueueClient
          facilities={facilities}
          self={profile}
          collectors={collectors}
          isManagement={profile.role === "management"}
        />
      </main>
    </>
  );
}
