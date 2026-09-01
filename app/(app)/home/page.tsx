import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import Header from "@/components/Header";
import { tabsForProfile } from "@/lib/nav";

// A lightweight landing menu — renders instantly (no data queries), so signing
// in never lands on the heavy Overview. Each tile links to a section; the
// data-heavy pages (Overview, etc.) load only when the user chooses them.
const BLURB: Record<string, string> = {
  "/overview": "Network AR, aging, census & status — full dashboard (loads more data)",
  "/queue": "Your assigned claims to work today",
  "/collections": "Work claims by facility, grouped by patient",
  "/adjustments": "Claim adjustments",
  "/auth-issues": "Claims routed to the auth team",
  "/management": "Management tools",
  "/authorizations": "Authorizations & reviews",
  "/negotiations": "Negotiations & renegotiations",
  "/medical-records": "Medical records requests & status",
  "/census": "Weekly census, groups & missed sessions",
  "/billed": "Billed claims report",
  "/payments": "Payments collected",
  "/insurance-payments": "Insurance deposit report import",
  "/repricing": "Repricing & renegotiation status",
  "/historical": "BCBS prefix / reimbursement reference",
  "/attachments": "Uploaded documents",
  "/notifications": "Email notification settings",
  "/reporting": "Reporting & analytics",
  "/monthly-report": "Monthly report",
  "/team": "Collector status & production",
  "/lookup": "Look up a patient",
  "/facility": "Your facility dashboard",
  "/import": "Weekly data import",
  "/admin": "Users, facilities & settings",
};

export default async function HomeMenu() {
  const { profile, email } = await requireProfile();
  if (profile.role === "pending") redirect("/pending");
  // Facility logins have their own landing.
  if (profile.role === "facility") redirect("/facility");
  const tabs = tabsForProfile(profile).filter((t) => t.href !== "/home");
  // First name if we have one, else the part before "@" of the email — never the
  // whole email address (a long unbreakable string blows out the phone layout).
  const greetName = profile.full_name?.trim()
    ? profile.full_name.trim().split(/\s+/)[0]
    : email
      ? email.split("@")[0]
      : "";

  return (
    <>
      <Header profile={profile} email={email} subtitle="Home" />
      <main className="min-w-0 flex-1 overflow-auto p-6" style={{ minHeight: 0 }}>
        <div className="mx-auto max-w-5xl">
          <h1 className="font-display text-2xl font-bold text-surface-ink break-words">
            Welcome{greetName ? `, ${greetName}` : ""}
          </h1>
          <p className="mt-1 text-sm text-surface-muted">Pick a section to get started.</p>

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tabs.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className="card flex items-start gap-3 p-4 transition hover:border-command hover:bg-command/5"
              >
                <span className="mt-0.5 text-xl text-command">{t.icon}</span>
                <span className="min-w-0">
                  <span className="block font-semibold text-surface-ink">{t.label}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-surface-muted">
                    {BLURB[t.href] ?? ""}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
