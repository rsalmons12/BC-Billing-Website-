import { createAdminClient } from "@/lib/supabase/admin";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Admin = ReturnType<typeof createAdminClient>;

// Resolve who receives a facility's invoice (and reminders):
//   • To  — that facility's own login(s) marked "Invoices" (primary facility_id
//           or an assignment). A facility only ever gets its OWN invoice.
//   • BCC — internal (non-facility) users marked "Invoices", copied on all.
// Shared by the invoice send and the reminder cron so they always agree.
export async function resolveInvoiceRecipients(
  facilityId: string,
  admin: Admin = createAdminClient()
): Promise<{ to: string[]; bcc: string[] }> {
  const emailsOf = async (ids: string[]): Promise<string[]> => {
    const out: string[] = [];
    for (const id of ids) {
      try {
        const { data } = await admin.auth.admin.getUserById(id);
        if (data?.user?.email) out.push(data.user.email);
      } catch {
        /* skip */
      }
    }
    return Array.from(new Set(out));
  };

  const [{ data: facProfs }, { data: asgs }, { data: internal }] = await Promise.all([
    admin
      .from("profiles")
      .select("id, facility_id")
      .eq("role", "facility")
      .eq("receives_invoices", true),
    admin.from("assignments").select("profile_id, facility_id"),
    // BCC copies go ONLY to owners — never other internal staff.
    admin.from("profiles").select("id").eq("is_owner", true),
  ]);

  const facIds = new Set((facProfs ?? []).map((p: any) => p.id));
  const facLogins = new Set<string>();
  for (const p of (facProfs ?? []) as { id: string; facility_id: string | null }[])
    if (p.facility_id === facilityId) facLogins.add(p.id);
  for (const a of (asgs ?? []) as { profile_id: string; facility_id: string | null }[])
    if (a.facility_id === facilityId && facIds.has(a.profile_id)) facLogins.add(a.profile_id);

  const to = await emailsOf(Array.from(facLogins));
  const bccAll = await emailsOf(((internal ?? []) as { id: string }[]).map((p) => p.id));
  const bcc = bccAll.filter((e) => !to.includes(e));
  return { to, bcc };
}
