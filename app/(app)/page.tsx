import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { tabsForProfile } from "@/lib/nav";

// Landing: send each user to their first allowed tab (respects per-user tab
// restrictions set in Admin).
export default async function Home() {
  const { profile } = await requireProfile();
  if (profile.role === "pending") redirect("/pending");
  const tabs = tabsForProfile(profile);
  // Everyone lands on the Network Overview dashboard when they can see it.
  if (tabs.some((t) => t.href === "/overview")) redirect("/overview");
  redirect(tabs[0]?.href ?? "/pending");
}
