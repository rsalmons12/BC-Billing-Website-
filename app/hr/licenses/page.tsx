import { createClient } from "@/lib/supabase/server";
import LicensesClient from "@/components/hr/LicensesClient";

export const dynamic = "force-dynamic";

export default async function LicensesPage() {
  const supabase = createClient();
  const { data } = await supabase
    .from("facilities")
    .select("id,name,short_name,state")
    .order("name");
  const facilities = ((data as { id: string; name: string; short_name: string | null; state: string | null }[]) ?? []).map(
    (f) => ({ id: f.id, label: f.short_name || f.name, state: f.state })
  );
  return <LicensesClient facilities={facilities} />;
}
