import * as React from "react";
import fs from "fs";
import path from "path";
import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeFacilityRecaps } from "@/lib/report/facilityRecap";
import { censusImageToken } from "@/lib/report/censusImageToken";

// Public (login-free) endpoint that renders a facility's weekly census as a
// branded PNG for MMS. Guarded by a per-facility signature. Patients are
// anonymized (Patient A/B/C) because the image is fetched over the internet.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const money0 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// Fonts (cached across requests). Best-effort: if the fetch fails, ImageResponse
// falls back to its built-in font.
let fontCache: { name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" }[] | null = null;
async function loadFonts() {
  if (fontCache) return fontCache;
  const urls: { w: 400 | 700; url: string }[] = [
    { w: 400, url: "https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-400-normal.woff" },
    { w: 700, url: "https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-700-normal.woff" },
  ];
  try {
    const out = [];
    for (const f of urls) {
      const res = await fetch(f.url);
      if (!res.ok) throw new Error("font fetch");
      out.push({ name: "Inter", data: await res.arrayBuffer(), weight: f.w, style: "normal" as const });
    }
    fontCache = out;
  } catch {
    fontCache = [];
  }
  return fontCache;
}

// BC Billing logo (the app icon), inlined as a data URI. Cached across requests.
let logoData: string | null = null;
function logoDataUri(): string {
  if (logoData !== null) return logoData;
  try {
    const buf = fs.readFileSync(path.join(process.cwd(), "public", "icon-192.png"));
    logoData = `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    logoData = "";
  }
  return logoData;
}

const BLUE = "#19a8e0";
const GREEN = "#37a635";
const NAVY = "#0e1c3a";
const INK = "#1f2a44";
const MUTED = "#6b7a90";

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
  const cur = recap?.census?.current;
  if (!recap || !cur) return new Response("No census", { status: 404 });

  const loc = recap.censusLocMix;
  const pm = recap.censusPayMix;
  const pct = (n: number) => (pm.total > 0 ? Math.round((n / pm.total) * 100) : 0);
  const mid = Math.max(0, pm.over1000 - pm.over2000); // $1,000–$2,000 band
  const censusExpected = recap.censusReceivables.reduce((s, r) => s + r.expected, 0);
  const top = recap.censusReceivables.slice(0, 5);
  const locBits = [
    loc.PHP ? `${loc.PHP} PHP` : "",
    loc.IOP ? `${loc.IOP} IOP` : "",
    loc.OP ? `${loc.OP} OP` : "",
    loc.other ? `${loc.other} other` : "",
  ]
    .filter(Boolean)
    .join(", ");

  const fonts = await loadFonts();

  const Card = (children: React.ReactNode, extra: React.CSSProperties = {}) => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: "#ffffff",
        borderRadius: 18,
        padding: 20,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        ...extra,
      }}
    >
      {children}
    </div>
  );

  const bullet = (color: string, label: string) => (
    <div style={{ display: "flex", alignItems: "center", marginTop: 4 }}>
      <div style={{ width: 12, height: 12, borderRadius: 6, background: color, marginRight: 8 }} />
      <div style={{ fontSize: 18, color: INK }}>{label}</div>
    </div>
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#eef2f7",
          fontFamily: "Inter",
          padding: 20,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            background: `linear-gradient(90deg, ${BLUE}, ${NAVY})`,
            borderRadius: 16,
            padding: "16px 20px",
            color: "#ffffff",
          }}
        >
          {logoDataUri() ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoDataUri()}
              width={68}
              height={68}
              alt="BC Billing"
              style={{ borderRadius: 16, marginRight: 16 }}
            />
          ) : null}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 15, letterSpacing: 2, color: "#cfe8fb" }}>BC BILLING SOLUTIONS</div>
            <div style={{ fontSize: 30, fontWeight: 700, marginTop: 2 }}>Billing Portal Update</div>
            <div style={{ fontSize: 14, letterSpacing: 1, color: "#cfe8fb", marginTop: 2 }}>
              REAL-TIME INSIGHTS. A STRONGER TOMORROW.
            </div>
          </div>
        </div>

        {/* Facility census */}
        <div style={{ display: "flex", flexDirection: "column", marginTop: 14 }}>
          {Card(
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: BLUE }}>{recap.name}</div>
              <div style={{ fontSize: 16, color: MUTED, marginTop: 2 }}>Census ({cur.weekLabel})</div>
              <div style={{ fontSize: 19, color: INK, marginTop: 6 }}>
                {cur.patients} clients{locBits ? ` — ${locBits}` : ""}
              </div>

              <div style={{ fontSize: 16, color: MUTED, marginTop: 10 }}>Reimbursement mix</div>
              {bullet(GREEN, `${pct(pm.over2000)}% over $2,000/day`)}
              {bullet(BLUE, `${pct(mid)}% $1,000–$2,000/day`)}
              {bullet("#8fd0f2", `${pct(pm.under800)}% under $800/day`)}

              {cur.missedGroups > 0 && (
                <div style={{ fontSize: 18, color: INK, marginTop: 10 }}>
                  Missed groups: {cur.missedGroups} (−{money0(cur.missedRev)})
                </div>
              )}
              <div style={{ fontSize: 18, color: INK, marginTop: 6, display: "flex" }}>
                <span>Expected revenue this week: </span>
                <span style={{ color: GREEN, fontWeight: 700, marginLeft: 6 }}>{money0(cur.expected)}</span>
              </div>
              <div style={{ fontSize: 18, color: INK, marginTop: 6, display: "flex" }}>
                <span>Collected this month: </span>
                <span style={{ color: GREEN, fontWeight: 700, marginLeft: 6 }}>
                  {money0(recap.collectedThisMonth)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Outstanding claims */}
        <div style={{ display: "flex", flexDirection: "column", marginTop: 14 }}>
          {Card(
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: BLUE }}>
                Top Outstanding Claims by Patient
              </div>
              {top.map((r, i) => (
                <div
                  key={i}
                  style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 17, color: INK }}
                >
                  <div style={{ display: "flex" }}>
                    Patient {String.fromCharCode(65 + i)} — {r.loc}, {money0(r.perDay)}/day x {r.outstanding}
                  </div>
                  <div style={{ fontWeight: 700 }}>{money0(r.expected)}</div>
                </div>
              ))}
              <div style={{ borderTop: "1px solid #e3e9f2", marginTop: 12, paddingTop: 10, display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 16, color: MUTED }}>Total expected on outstanding claims</div>
                <div style={{ fontSize: 30, fontWeight: 700, color: GREEN }}>{money0(censusExpected)}</div>
                <div style={{ fontSize: 15, color: MUTED, marginTop: 2 }}>Full recap in the app.</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", flexDirection: "column", marginTop: "auto", paddingTop: 14 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              background: "#e6f4fd",
              borderRadius: 14,
              padding: "12px 16px",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700, color: NAVY }}>
              Data this week. A stronger tomorrow.
            </div>
            <div style={{ fontSize: 12, letterSpacing: 2, color: BLUE, marginTop: 2 }}>
              POWERED BY BC BILLING
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: 620,
      height: 1000,
      ...(fonts.length ? { fonts } : {}),
    }
  );
}
