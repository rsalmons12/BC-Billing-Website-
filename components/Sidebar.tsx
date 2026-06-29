"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "@/components/Logo";
import { tabsForProfile } from "@/lib/nav";
import type { Profile } from "@/lib/types";

export default function Sidebar({ profile }: { profile: Profile }) {
  const pathname = usePathname();
  const items = tabsForProfile(profile);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem("rd_sidebar_collapsed") === "1");
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("rd_sidebar_collapsed", next ? "1" : "0");
      return next;
    });
  };

  return (
    <aside
      className={`flex shrink-0 flex-col bg-command text-command-text transition-[width] duration-200 ${
        collapsed ? "w-16" : "w-60"
      }`}
    >
      <div className="flex items-center gap-3 px-4 py-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center">
          <Logo size={34} />
        </div>
        {!collapsed && (
          <div className="leading-tight">
            <div className="font-display text-sm font-bold">BC Billing</div>
            <div className="text-[11px] text-command-muted">Recovery Desk</div>
          </div>
        )}
      </div>

      <nav className="mt-2 flex-1 space-y-1 px-2.5">
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                collapsed ? "justify-center" : ""
              } ${
                active
                  ? "bg-command-surface text-command-text"
                  : "text-command-muted hover:bg-command-surface/60 hover:text-command-text"
              }`}
            >
              <span
                className={`text-base ${active ? "text-brand-blue" : "text-command-muted"}`}
              >
                {item.icon}
              </span>
              {!collapsed && item.label}
            </Link>
          );
        })}
      </nav>

      <button
        onClick={toggle}
        className="m-2.5 flex items-center justify-center gap-2 rounded-lg border border-command-border py-2 text-xs font-semibold text-command-muted hover:bg-command-surface hover:text-command-text"
        title={collapsed ? "Expand menu" : "Collapse menu"}
      >
        {collapsed ? "»" : "« Collapse"}
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 text-[11px] text-command-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-green" />
            Secured by Row-Level Security
          </span>
        </div>
      )}
    </aside>
  );
}
