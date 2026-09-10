import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Header from "@/components/Header";
import MonthlyReportClient from "@/components/report/MonthlyReportClient";
import type { Facility } from "@/lib/types";

export default async function MonthlyReportPage() {
  const { profile, email } = await requireProfile();
  // Invoicing is owner-only: managers may run everything else, not the invoices.
  if (profile.role !== "management" || profile.is_owner !== true) redirect("/");

  // Load EVERY facility (not the collector-facing accessible list, which hides
  // Kingsway/Renewed and demo). The owner invoices and tracks all of them, so
  // every invoice row must resolve to its real facility name — not "Facility".
  const supabase = createClient();
  const { data } = await supabase.from("facilities").select("*").order("name", { ascending: true });
  const facilities = (data as Facility[]) ?? [];

  return (
    <>
      <Header profile={profile} email={email} subtitle="Monthly Report" />
      <main className="min-h-0 flex-1 overflow-auto">
        <MonthlyReportClient facilities={facilities} />
      </main>
    </>
  );
}
