import { createClient } from "@supabase/supabase-js";

// Service-role client. SERVER-ONLY. Bypasses RLS — never import this into a
// client component or expose the key to the browser. Used solely by the admin
// "invite/create user" route.
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
