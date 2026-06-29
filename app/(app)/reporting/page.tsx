import { redirect } from "next/navigation";
import { requireProfile, accessibleFacilities } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Header from "@/components/Header";
import ReportingClient from "@/components/reporting/ReportingClient";
import type { Profile } from "@/lib/types";

export default async function ReportingPage() {
  const { profile, email } = await requireProfile();
  if (profile.role !== "management") redirect("/");

  const facilities = await accessibleFacilities();

  const supabase = createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("role", "staff")
    .order("full_name");
  const collectors = (data as Profile[]) ?? [];

  return (
    <>
      <Header profile={profile} email={email} subtitle="Reporting & Analytics" />
      <main className="min-h-0 flex-1 overflow-auto p-6">
        <ReportingClient facilities={facilities} collectors={collectors} />
      </main>
    </>
  );
}
