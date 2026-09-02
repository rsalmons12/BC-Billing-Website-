import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isExcludedFacility } from "@/lib/claims";
import type { Profile, Facility } from "@/lib/types";

// Loads the authenticated user's profile. Redirects to /login if not signed in.
//
// Wrapped in React.cache so the layout AND the page (which both call this on
// every navigation) share ONE result per request — halving the auth round-trips
// (getUser + profiles query) that otherwise ran twice per page load.
export const requireProfile = cache(async function requireProfile(): Promise<{
  userId: string;
  email: string | null;
  profile: Profile;
}> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  // The handle_new_user() trigger creates a profile on signup. If it is
  // somehow missing, treat the user as pending.
  const resolved: Profile =
    (profile as Profile) ??
    ({
      id: user.id,
      full_name: user.email ?? null,
      initials: null,
      role: "pending",
      facility_id: null,
      allowed_tabs: null,
      daily_target: 100,
      job_title: null,
      queue_tier: "standard",
      created_at: new Date().toISOString(),
    } as Profile);

  return { userId: user.id, email: user.email ?? null, profile: resolved };
});

// Facilities the current user may see (RLS already enforces this; this is the
// list used to render pickers/labels).
export async function accessibleFacilities(): Promise<Facility[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("facilities")
    .select("*")
    .order("name", { ascending: true });
  // Hidden facilities (Kingsway, Renewed Light) are stripped from every
  // collector-facing list — Collections/AR, Queue, Negotiations, Census, etc.
  // (Admin loads facilities directly, so they stay manageable there.)
  return ((data as Facility[]) ?? []).filter(
    (f) => !isExcludedFacility(f.name) && !isExcludedFacility(f.short_name)
  );
}
