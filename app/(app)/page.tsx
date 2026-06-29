import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { tabsForProfile } from "@/lib/nav";

// Landing: send each user to their first allowed tab (respects per-user tab
// restrictions set in Admin).
export default async function Home() {
  const { profile } = await requireProfile();
  if (profile.role === "pending") redirect("/pending");
  const tabs = tabsForProfile(profile);
  // Facility logins land on their dashboard when they have it.
  if (profile.role === "facility" && tabs.some((t) => t.href === "/facility")) {
    redirect("/facility");
  }
  redirect(tabs[0]?.href ?? "/pending");
}
