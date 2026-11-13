import { redirect } from "next/navigation";
import { requireProfile, accessibleFacilities } from "@/lib/auth";
import Header from "@/components/Header";
import ProjectionsClient from "@/components/projections/ProjectionsClient";

export default async function ProjectionsPage() {
  const { profile, email } = await requireProfile();
  if (profile.role === "pending") redirect("/");
  const facilities = await accessibleFacilities();
  return (
    <>
      <Header profile={profile} email={email} subtitle="Projected Revenue" />
      <main className="min-h-0 flex-1 overflow-hidden">
        <ProjectionsClient facilities={facilities} />
      </main>
    </>
  );
}
