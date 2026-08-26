import { redirect } from "next/navigation";
import { requireProfile, accessibleFacilities } from "@/lib/auth";
import Header from "@/components/Header";
import MonthlyReportClient from "@/components/report/MonthlyReportClient";

export default async function MonthlyReportPage() {
  const { profile, email } = await requireProfile();
  // Invoicing is owner-only: managers may run everything else, not the invoices.
  if (profile.role !== "management" || profile.is_owner !== true) redirect("/");

  const facilities = await accessibleFacilities();

  return (
    <>
      <Header profile={profile} email={email} subtitle="Monthly Report" />
      <main className="min-h-0 flex-1 overflow-auto">
        <MonthlyReportClient facilities={facilities} />
      </main>
    </>
  );
}
