import type { Profile, Role } from "@/lib/types";

export type Tab = {
  href: string;
  label: string;
  icon: string;
  roles: Role[]; // roles that may access at all
};

// Single source of truth for navigation + per-user access.
export const TABS: Tab[] = [
  { href: "/overview", label: "Overview", icon: "▦", roles: ["management"] },
  { href: "/queue", label: "My Queue", icon: "◎", roles: ["management", "staff"] },
  { href: "/collections", label: "Collections", icon: "▤", roles: ["management", "staff"] },
  { href: "/adjustments", label: "Adjustments", icon: "✎", roles: ["management", "staff"] },
  { href: "/marketplace", label: "Marketplace / Exchange", icon: "⇄", roles: ["management", "staff"] },
  { href: "/auth-issues", label: "Auth Issues", icon: "✦", roles: ["management", "staff"] },
  { href: "/messages", label: "Messages", icon: "✉", roles: ["management", "staff", "facility"] },
  { href: "/management", label: "Management", icon: "★", roles: ["management", "staff"] },
  { href: "/authorizations", label: "Authorization", icon: "✓", roles: ["management", "staff", "facility"] },
  { href: "/negotiations", label: "Negotiations", icon: "⇄", roles: ["management", "staff", "facility"] },
  { href: "/medical-records", label: "Medical Records", icon: "▥", roles: ["management", "staff", "facility"] },
  { href: "/census", label: "Weekly Census", icon: "🗒", roles: ["management", "staff", "facility"] },
  { href: "/billed", label: "Billed", icon: "❒", roles: ["management", "staff", "facility"] },
  { href: "/payments", label: "Payments", icon: "$", roles: ["management", "staff", "facility"] },
  { href: "/repricing", label: "Repricing", icon: "◷", roles: ["management", "staff", "facility"] },
  { href: "/historical", label: "Historical Data", icon: "≣", roles: ["management", "staff", "facility"] },
  { href: "/assignments", label: "Weekly Assignments", icon: "☷", roles: ["management", "staff"] },
  { href: "/attachments", label: "Attachments", icon: "📎", roles: ["management", "staff"] },
  { href: "/reporting", label: "Reporting & Analytics", icon: "▲", roles: ["management"] },
  { href: "/monthly-report", label: "Monthly Report", icon: "🗓", roles: ["management"] },
  { href: "/team", label: "Collector Status", icon: "◉", roles: ["management"] },
  { href: "/lookup", label: "Patient Lookup", icon: "🔎", roles: ["management"] },
  { href: "/facility", label: "Dashboard", icon: "▣", roles: ["facility"] },
  { href: "/import", label: "Weekly Import", icon: "↥", roles: ["management"] },
  { href: "/admin", label: "Admin", icon: "⚙", roles: ["management"] },
];

// Tabs a facility login can be granted (read-only). Management/staff get all
// tabs allowed for their role unless restricted.
export const FACILITY_GRANTABLE = TABS.filter((t) =>
  t.roles.includes("facility")
);

// The tabs a given profile may actually see: role-allowed, then narrowed by
// allowed_tabs if management has set an explicit list.
export function tabsForProfile(profile: Profile): Tab[] {
  const roleTabs = TABS.filter((t) => t.roles.includes(profile.role));
  if (!profile.allowed_tabs || profile.allowed_tabs.length === 0) return roleTabs;
  const set = new Set(profile.allowed_tabs);
  return roleTabs.filter((t) => set.has(t.href));
}
