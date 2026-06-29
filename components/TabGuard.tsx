"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

// Client-side enforcement: if the user lands on a tab they aren't allowed to
// see (e.g. by typing the URL), bounce them to their first allowed tab.
// Data is already protected by RLS; this keeps the UI consistent.
export default function TabGuard({
  allowed,
  fallback,
}: {
  allowed: string[];
  fallback: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (pathname === "/" || pathname === "/pending") return;
    const ok = allowed.some(
      (href) => pathname === href || pathname.startsWith(href + "/")
    );
    if (!ok) router.replace(fallback);
  }, [pathname, allowed, fallback, router]);

  return null;
}
