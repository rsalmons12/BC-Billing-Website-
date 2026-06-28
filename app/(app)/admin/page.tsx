import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Header from "@/components/Header";
import AdminClient from "@/components/admin/AdminClient";
import type { Profile, Facility, Assignment } from "@/lib/types";

export default async function AdminPage() {
  const { profile, email } = await requireProfile();
  if (profile.role !== "management") redirect("/");

  const supabase = createClient();
  const [{ data: profiles }, { data: facilities }, { data: assignments }] =
    await Promise.all([
      supabase.from("profiles").select("*").order("created_at"),
      supabase.from("facilities").select("*").order("name"),
      supabase.from("assignments").select("*"),
    ]);

  return (
    <>
      <Header profile={profile} email={email} subtitle="Admin" />
      <main className="min-h-0 flex-1 overflow-auto p-6">
        <AdminClient
          initialProfiles={(profiles as Profile[]) ?? []}
          initialFacilities={(facilities as Facility[]) ?? []}
          initialAssignments={(assignments as Assignment[]) ?? []}
          selfId={profile.id}
        />
      </main>
    </>
  );
}
