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

// True only when this job already logged a completed send for the given Eastern
// day (its detail starts with "SENT <etDate>"). Used so the job can be triggered
// SEVERAL times inside its window — to survive GitHub's flaky cron timing —
// while still sending at most once per day. FAIL-OPEN: any error returns false,
// so a logging hiccup can only ever cause a duplicate send, never a missed one.
export async function alreadySentToday(admin: Admin, job: string, etDate: string): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from("cron_log")
      .select("id")
      .eq("job", job)
      .like("detail", `SENT ${etDate}%`)
      .limit(1);
    if (error) return false;
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}
