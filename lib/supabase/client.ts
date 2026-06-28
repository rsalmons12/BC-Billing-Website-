"use client";

import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client. All reads/writes through this client are
// constrained by Row-Level Security — the client is never the security
// boundary, RLS is.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
