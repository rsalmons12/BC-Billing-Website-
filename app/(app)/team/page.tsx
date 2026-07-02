import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Header from "@/components/Header";
import TeamStatusClient from "@/components/team/TeamStatusClient";
import type { Profile } from "@/lib/types";

export default async function TeamStatusPage() {
  const { profile, email } = await requireProfile();
  if (profile.role !== "management") redirect("/");

  const supabase = createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("role", "staff")
    .order("full_name");
  const collectors = (data as Profile[]) ?? [];

  return (
    <>
      <Header profile={profile} email={email} subtitle="Collector Status" />
      <main className="min-h-0 flex-1 overflow-hidden">
        <TeamStatusClient collectors={collectors} />
      </main>
    </>
  );
}
