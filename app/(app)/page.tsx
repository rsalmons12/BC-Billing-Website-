import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";

// Role-based landing: send each role to its home module.
export default async function Home() {
  const { profile } = await requireProfile();

  switch (profile.role) {
    case "management":
      redirect("/overview");
    case "staff":
      redirect("/collections");
    case "facility":
      redirect("/facility");
    default:
      redirect("/pending");
  }
}
