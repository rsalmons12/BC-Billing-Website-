"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { tabsForProfile } from "@/lib/nav";
import type { Profile } from "@/lib/types";

// Phone navigation: a fixed bottom tab bar (replaces the left sidebar on small
// screens). Shows the tabs flagged `mobile` — falls back to all tabs. Desktop
// keeps the left Sidebar; this is hidden at md+.
export default function MobileBottomNav({ profile }: { profile: Profile }) {
  const pathname = usePathname();
  const all = tabsForProfile(profile);
  const primary = all.filter((t) => t.mobile);
  const items = primary.length ? primary : all;

  return (
    <nav className="shrink-0 border-t border-command-border bg-command text-command-text md:hidden">
      <div className="flex overflow-x-auto">
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-w-[4.25rem] flex-1 flex-col items-center gap-0.5 px-1 py-2 text-[10px] font-semibold leading-tight ${
                active ? "text-brand-blue" : "text-command-muted"
              }`}
            >
              <span className={`text-lg ${active ? "text-brand-blue" : "text-command-muted"}`}>
                {item.icon}
              </span>
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
