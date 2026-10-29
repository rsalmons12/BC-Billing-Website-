import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import DocumentsClient from "@/components/hr/DocumentsClient";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const { userId } = await requireProfile();
  const supabase = createClient();
  const { data } = await supabase.from("facilities").select("id,name,short_name").order("name");
  const facilities = ((data as { id: string; name: string; short_name: string | null }[]) ?? []).map((f) => ({
    id: f.id,
    label: f.short_name || f.name,
  }));
  return <DocumentsClient facilities={facilities} userId={userId} />;
}
