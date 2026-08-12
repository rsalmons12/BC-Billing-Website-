import type { SupabaseClient } from "@supabase/supabase-js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Admin = SupabaseClient<any, any, any>;

// Record one heartbeat row for a scheduled job. Best-effort: if the cron_log
// table isn't there yet (migration not applied) or the write fails, we swallow
// the error so logging can never break the actual job.
export async function logCronRun(admin: Admin, job: string, detail: string): Promise<void> {
  try {
    await admin.from("cron_log").insert({ job, detail });
  } catch {
    /* ignore — logging must never break the cron */
  }
}
