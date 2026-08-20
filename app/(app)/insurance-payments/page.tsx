import { redirect } from "next/navigation";
import { requireProfile, accessibleFacilities } from "@/lib/auth";
import Header from "@/components/Header";
import InsurancePaymentsClient from "@/components/payments/InsurancePaymentsClient";

export default async function InsurancePaymentsPage() {
  const { profile, email } = await requireProfile();
  if (profile.role === "pending") redirect("/");
  const facilities = await accessibleFacilities();
  return (
    <>
      <Header profile={profile} email={email} subtitle="Insurance Payments" />
      <main className="min-h-0 flex-1 overflow-hidden">
        <InsurancePaymentsClient
          facilities={facilities}
          userId={profile.id}
          isManagement={profile.role === "management"}
          readOnly={profile.role === "facility"}
        />
      </main>
    </>
  );
}
