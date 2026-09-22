import { createAdminClient } from "@/lib/supabase/admin";
import { computeFacilityRecaps } from "@/lib/report/facilityRecap";
import { censusImageToken } from "@/lib/report/censusImageToken";
import { renderCensusPng } from "@/lib/report/censusImage";

// Public (login-free) endpoint that renders a facility's weekly census as a
// branded PNG. Used for the in-app "View image" preview; the MMS send routes
// pre-render and host a static file so Twilio never triggers this computation.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const f = url.searchParams.get("f") || "";
  const t = url.searchParams.get("t") || "";
  if (!f || t !== censusImageToken(f)) return new Response("Not found", { status: 404 });

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return new Response("unavailable", { status: 503 });
  }
  const recaps = await computeFacilityRecaps(admin, { facilityIds: [f] }).catch(() => []);
  const recap = recaps[0];
  if (!recap || !recap.census?.current) return new Response("No census", { status: 404 });

  try {
    const png = await renderCensusPng(recap);
    return new Response(new Uint8Array(png), {
      headers: { "content-type": "image/png", "cache-control": "no-store" },
    });
  } catch (e) {
    return new Response(`image error: ${e instanceof Error ? e.message : "unknown"}`, { status: 500 });
  }
}
