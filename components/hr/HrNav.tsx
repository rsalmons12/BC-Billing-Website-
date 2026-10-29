"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/hr", label: "Dashboard" },
  { href: "/hr/licenses", label: "State Licenses" },
  { href: "/hr/staff", label: "Staff / HR" },
  { href: "/hr/documents", label: "Compliance Docs" },
];

export default function HrNav({ name, isManagement }: { name: string; isManagement: boolean }) {
  const path = usePathname();
  return (
    <header className="border-b border-surface-border bg-surface-card">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 md:px-6">
        <div className="flex items-center gap-2">
          <span className="font-display text-lg font-extrabold text-brand-blue">BC Billing</span>
          <span className="badge bg-brand-blue/10 text-brand-blue">HR &amp; Compliance</span>
        </div>
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          {LINKS.map((l) => {
            const active = l.href === "/hr" ? path === "/hr" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-lg px-3 py-1.5 font-medium transition ${
                  active
                    ? "bg-brand-blue/10 text-brand-blue"
                    : "text-surface-muted hover:text-surface-ink"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          {isManagement && (
            <Link href="/overview" className="text-xs text-surface-muted hover:text-surface-ink">
              ← Main app
            </Link>
          )}
          <span className="hidden text-surface-muted sm:inline">{name}</span>
          <form action="/auth/signout" method="post">
            <button className="btn-ghost px-3 py-1.5 text-xs">Sign out</button>
          </form>
        </div>
      </div>
    </header>
  );
}
