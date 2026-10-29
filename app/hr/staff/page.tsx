import { createClient } from "@/lib/supabase/server";
import StaffClient from "@/components/hr/StaffClient";

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const supabase = createClient();
  const { data } = await supabase.from("facilities").select("id,name,short_name").order("name");
  const facilities = ((data as { id: string; name: string; short_name: string | null }[]) ?? []).map((f) => ({
    id: f.id,
    label: f.short_name || f.name,
  }));
  return <StaffClient facilities={facilities} />;
}
