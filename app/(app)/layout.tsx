import { requireProfile } from "@/lib/auth";
import { tabsForProfile } from "@/lib/nav";
import Sidebar from "@/components/Sidebar";
import TabGuard from "@/components/TabGuard";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireProfile();
  const allowed = tabsForProfile(profile).map((t) => t.href);
  const fallback = allowed[0] ?? "/pending";

  return (
    <div className="flex h-screen overflow-hidden">
      <TabGuard allowed={allowed} fallback={fallback} />
      <Sidebar profile={profile} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
