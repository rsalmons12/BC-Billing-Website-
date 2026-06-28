"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/types";

type NavItem = { href: string; label: string; roles: Role[]; icon: string };

const NAV: NavItem[] = [
  { href: "/overview", label: "Overview", roles: ["management"], icon: "▦" },
  { href: "/collections", label: "Collections", roles: ["management", "staff"], icon: "▤" },
  { href: "/auth-issues", label: "Auth Issues", roles: ["management", "staff"], icon: "✦" },
  { href: "/facility", label: "Dashboard", roles: ["facility"], icon: "▣" },
  { href: "/import", label: "Weekly Import", roles: ["management"], icon: "↥" },
  { href: "/admin", label: "Admin", roles: ["management"], icon: "⚙" },
];

export default function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const items = NAV.filter((n) => n.roles.includes(role));

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-command text-command-text">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gold font-display text-base font-extrabold text-command">
          RD
        </div>
        <div className="leading-tight">
          <div className="font-display text-sm font-bold">Recovery Desk</div>
          <div className="text-[11px] text-command-muted">BC Billing Solutions</div>
        </div>
      </div>

      <nav className="mt-2 flex-1 space-y-1 px-3">
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-command-surface text-command-text"
                  : "text-command-muted hover:bg-command-surface/60 hover:text-command-text"
              }`}
            >
              <span
                className={`text-base ${active ? "text-gold" : "text-command-muted"}`}
              >
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-4 text-[11px] text-command-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-recovered" />
          Secured by Row-Level Security
        </span>
      </div>
    </aside>
  );
}
