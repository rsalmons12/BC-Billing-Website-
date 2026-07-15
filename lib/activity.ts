import type { SupabaseClient } from "@supabase/supabase-js";

// Today's local date as YYYY-MM-DD (production is bucketed by local day).
function localDay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// Log one auth/auth-issue action so daily production credits every edit on the
// day it happened. Fire-and-forget: never blocks or breaks the save flow.
export async function logAuthActivity(
  supabase: SupabaseClient,
  args: {
    record_type: "authorization" | "auth_issue";
    record_id: string | null;
    facility_id: string | null;
    action?: "create" | "update" | "complete";
    field?: string;
  }
): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("auth_activity").insert({
      record_type: args.record_type,
      record_id: args.record_id,
      facility_id: args.facility_id,
      actor_id: user.id,
      action: args.action ?? "update",
      field: args.field ?? "",
      worked_on: localDay(),
    });
  } catch {
    // Activity logging is best-effort; ignore failures.
  }
}
