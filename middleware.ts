import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Run on everything except static assets, image files, the public
    // web manifest, and the cron-triggered daily-backup API route.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|api/admin/daily-backup|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)",
  ],
};
