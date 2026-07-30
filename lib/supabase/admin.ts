import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./config";

// Service-role client. SERVER-ONLY. Bypasses RLS — never import this into a
// client component or expose the key to the browser. Used solely by the admin
// "invite/create user" route.
export function createAdminClient() {
  // Strip ALL whitespace: service keys never contain any, and a stray space or
  // newline from a copy/paste into the hosting dashboard otherwise produces an
  // "invalid header value" error.
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").replace(/\s+/g, "");
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }
  return createClient(SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
