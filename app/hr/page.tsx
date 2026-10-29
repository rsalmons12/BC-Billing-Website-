import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/page";
import { daysUntil, expiryTone, EXPIRY_CLASS, fmtDate } from "@/lib/hr";
import type { FacilityLicense, StaffMember, ComplianceDocument } from "@/lib/types";

export const dynamic = "force-dynamic";

type FacRow = { id: string; name: string; short_name: string | null };

export default async function HrDashboard() {
  const supabase = createClient();
  const safe = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);
  const [licenses, staff, docs, facs] = await Promise.all([
    safe(selectAll<FacilityLicense>((f, t) => supabase.from("facility_licenses").select("*").range(f, t))),
    safe(selectAll<StaffMember>((f, t) => supabase.from("staff_members").select("*").range(f, t))),
    safe(selectAll<ComplianceDocument>((f, t) => supabase.from("compliance_documents").select("*").range(f, t))),
    safe(selectAll<FacRow>((f, t) => supabase.from("facilities").select("id,name,short_name").range(f, t))),
  ]);
  const facName = (id: string | null) => {
    const f = facs.find((x) => x.id === id);
    return f ? f.short_name || f.name : "—";
  };

  const soon = (iso: string | null | undefined) => {
    const tone = expiryTone(iso);
    return tone === "expired" || tone === "soon";
  };
  const licAlerts = licenses
    .filter((l) => soon(l.expires_date))
    .sort((a, b) => (daysUntil(a.expires_date) ?? 1e9) - (daysUntil(b.expires_date) ?? 1e9));
  const credAlerts = staff
    .filter((s) => soon(s.credential_expires))
    .sort((a, b) => (daysUntil(a.credential_expires) ?? 1e9) - (daysUntil(b.credential_expires) ?? 1e9));
  const activeStaff = staff.filter((s) => (s.status ?? "active") === "active").length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold text-surface-ink">HR &amp; Compliance</h1>
        <p className="text-sm text-surface-muted">
          State licenses, staff credentials, and compliance documents across your facilities.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="State Licenses" value={licenses.length} sub={`${licAlerts.length} need attention`} href="/hr/licenses" alert={licAlerts.length > 0} />
        <Tile label="Staff" value={staff.length} sub={`${activeStaff} active`} href="/hr/staff" />
        <Tile label="Credentials due" value={credAlerts.length} sub="expiring / expired" href="/hr/staff" alert={credAlerts.length > 0} />
        <Tile label="Documents" value={docs.length} sub="on file" href="/hr/documents" />
      </section>

      <section className="card p-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">Licenses expiring or expired</h2>
          <Link href="/hr/licenses" className="text-sm text-brand-blue hover:underline">Manage →</Link>
        </div>
        {licAlerts.length === 0 ? (
          <p className="text-sm text-surface-muted">Nothing expiring in the next 60 days. 🎉</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-surface-muted">
                  <th className="px-2 py-1.5">Facility</th>
                  <th className="px-2 py-1.5">License</th>
                  <th className="px-2 py-1.5">State / body</th>
                  <th className="px-2 py-1.5 text-right">Expires</th>
                </tr>
              </thead>
              <tbody>
                {licAlerts.map((l) => (
                  <tr key={l.id} className="border-t border-surface-border">
                    <td className="px-2 py-1.5 font-medium text-surface-ink">{facName(l.facility_id)}</td>
                    <td className="px-2 py-1.5">{l.license_type || "—"}</td>
                    <td className="px-2 py-1.5 text-surface-muted">{[l.license_state, l.licensing_body].filter(Boolean).join(" · ") || "—"}</td>
                    <td className={`px-2 py-1.5 text-right ${EXPIRY_CLASS[expiryTone(l.expires_date)]}`}>{fmtDate(l.expires_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card p-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">Staff credentials expiring or expired</h2>
          <Link href="/hr/staff" className="text-sm text-brand-blue hover:underline">Manage →</Link>
        </div>
        {credAlerts.length === 0 ? (
          <p className="text-sm text-surface-muted">No credentials expiring in the next 60 days.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-surface-muted">
                  <th className="px-2 py-1.5">Staff</th>
                  <th className="px-2 py-1.5">Credential</th>
                  <th className="px-2 py-1.5">Facility</th>
                  <th className="px-2 py-1.5 text-right">Expires</th>
                </tr>
              </thead>
              <tbody>
                {credAlerts.map((s) => (
                  <tr key={s.id} className="border-t border-surface-border">
                    <td className="px-2 py-1.5 font-medium text-surface-ink">{s.full_name}</td>
                    <td className="px-2 py-1.5">{[s.credential_type, s.credential_state].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-2 py-1.5 text-surface-muted">{facName(s.facility_id)}</td>
                    <td className={`px-2 py-1.5 text-right ${EXPIRY_CLASS[expiryTone(s.credential_expires)]}`}>{fmtDate(s.credential_expires)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value, sub, href, alert }: { label: string; value: number; sub: string; href: string; alert?: boolean }) {
  return (
    <Link href={href} className="card card-hover p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-surface-muted">{label}</div>
      <div className={`mt-1 font-display text-2xl font-bold ${alert ? "text-risk" : "text-surface-ink"}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-surface-muted">{sub}</div>
    </Link>
  );
}
