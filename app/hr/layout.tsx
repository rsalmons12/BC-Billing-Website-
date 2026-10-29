import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import HrNav from "@/components/hr/HrNav";

// The HR & Compliance portal (served at hr.bcbilling.cloud, also reachable at
// /hr). Only HR logins and management may enter.
export const dynamic = "force-dynamic";

export default async function HrLayout({ children }: { children: React.ReactNode }) {
  const { profile, email } = await requireProfile();
  if (profile.role !== "hr" && profile.role !== "management") redirect("/");

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <HrNav
        name={profile.full_name || email || "User"}
        isManagement={profile.role === "management"}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
