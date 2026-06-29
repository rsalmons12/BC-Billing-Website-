import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import Header from "@/components/Header";
import HistoricalClient from "@/components/historical/HistoricalClient";

export default async function HistoricalPage() {
  const { profile, email } = await requireProfile();
  if (profile.role === "pending") redirect("/");
  return (
    <>
      <Header profile={profile} email={email} subtitle="Historical Data" />
      <main className="min-h-0 flex-1 overflow-hidden">
        <HistoricalClient canEdit={profile.role === "management"} />
      </main>
    </>
  );
}
