import { redirect } from "next/navigation";
import { requireProfile, accessibleFacilities } from "@/lib/auth";
import Header from "@/components/Header";
import PaymentsClient from "@/components/payments/PaymentsClient";

export default async function PaymentsPage() {
  const { profile, email } = await requireProfile();
  if (profile.role !== "management" && profile.role !== "staff") redirect("/");
  const facilities = await accessibleFacilities();
  return (
    <>
      <Header profile={profile} email={email} subtitle="Payments" />
      <main className="min-h-0 flex-1 overflow-hidden">
        <PaymentsClient
          facilities={facilities}
          userId={profile.id}
          isManagement={profile.role === "management"}
        />
      </main>
    </>
  );
}
