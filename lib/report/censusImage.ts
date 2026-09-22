import fs from "fs";
import path from "path";
import sharp from "sharp";
import type { FacilityRecap } from "@/lib/report/facilityRecap";

// Renders a facility's weekly census as a branded PNG (via sharp rasterizing a
// hand-built SVG). Shared by the on-demand image endpoint and the send routes
// (which pre-render so Twilio fetches a ready-made file, not a slow computation).

const money0 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

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
const W = 620;
const PAD = 20;
const CARD_X = PAD;
const CARD_W = W - PAD * 2;
const TX = PAD + 20;

type T = { size: number; color: string; weight?: number; ls?: number; anchor?: "start" | "end" };
const text = (x: number, y: number, s: string, o: T) =>
  `<text x="${x}" y="${y}" font-family="sans-serif" font-size="${o.size}" fill="${o.color}"` +
  `${o.weight ? ` font-weight="${o.weight}"` : ""}${o.ls ? ` letter-spacing="${o.ls}"` : ""}` +
  `${o.anchor === "end" ? ` text-anchor="end"` : ""}>${esc(s)}</text>`;

export function buildCensusSvg(recap: FacilityRecap): string {
  // Reported = last completed week (prior), matching the recap's census fields.
  const cur = (recap.census!.prior ?? recap.census!.current)!;
  const loc = recap.censusLocMix;
  const pm = recap.censusPayMix;
  const pct = (n: number) => (pm.total > 0 ? Math.round((n / pm.total) * 100) : 0);
  const mid = Math.max(0, pm.over1000 - pm.over2000);
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

  const parts: string[] = [];
  let y = PAD;

  const hH = 96;
  parts.push(`<rect x="${CARD_X}" y="${y}" width="${CARD_W}" height="${hH}" rx="16" fill="url(#hg)"/>`);
  const logo = logoDataUri();
  if (logo) {
    parts.push(
      `<clipPath id="lc"><rect x="${PAD + 16}" y="${y + 14}" width="68" height="68" rx="15"/></clipPath>`,
      `<image href="${logo}" x="${PAD + 16}" y="${y + 14}" width="68" height="68" clip-path="url(#lc)"/>`
    );
  }
  const htx = logo ? PAD + 16 + 68 + 16 : TX;
  parts.push(text(htx, y + 30, "BC BILLING SOLUTIONS", { size: 13, color: "#cfe8fb", ls: 2 }));
  parts.push(text(htx, y + 60, "Billing Portal Update", { size: 28, color: "#ffffff", weight: 700 }));
  parts.push(text(htx, y + 82, "REAL-TIME INSIGHTS. A STRONGER TOMORROW.", { size: 12, color: "#cfe8fb", ls: 1 }));
  y += hH + 14;

  const c1 = y;
  const lines1: string[] = [];
  let iy = c1 + 36;
  lines1.push(text(TX, iy, recap.name, { size: 24, color: BLUE, weight: 700 }));
  iy += 26;
  lines1.push(text(TX, iy, `Census (${cur.weekLabel})`, { size: 16, color: MUTED }));
  iy += 30;
  lines1.push(text(TX, iy, `${cur.patients} clients${locBits ? ` — ${locBits}` : ""}`, { size: 19, color: INK }));
  iy += 32;
  lines1.push(text(TX, iy, "Reimbursement mix", { size: 15, color: MUTED }));
  iy += 28;
  const bullet = (color: string, label: string) => {
    const b =
      `<circle cx="${TX + 7}" cy="${iy - 6}" r="7" fill="${color}"/>` +
      text(TX + 22, iy, label, { size: 18, color: INK });
    iy += 28;
    return b;
  };
  lines1.push(bullet(GREEN, `${pct(pm.over2000)}% over $2,000/day`));
  lines1.push(bullet(BLUE, `${pct(mid)}% $1,000–$2,000/day`));
  lines1.push(bullet("#8fd0f2", `${pct(pm.under800)}% under $800/day`));
  iy += 4;
  if (cur.missedGroups > 0) {
    const rev = cur.missedRev > 0 ? ` (−${money0(cur.missedRev)})` : "";
    lines1.push(text(TX, iy, `Missed groups: ${cur.missedGroups}${rev}`, { size: 18, color: INK }));
    iy += 28;
  }
  const kv = (label: string, value: string, color = INK) => {
    lines1.push(text(TX, iy, label, { size: 18, color: INK }));
    lines1.push(text(W - PAD - 20, iy, value, { size: 18, color, weight: 700, anchor: "end" }));
    iy += 28;
  };
  kv("Total Billed (this month)", money0(recap.billedMonth));
  kv("Total Collected (this month)", money0(recap.collectedMonth), GREEN);
  kv("Collection Rate", `${Math.round(recap.collectionRate * 100)}%`);
  kv("Total Outstanding (AR)", money0(recap.totalAR));
  iy -= 16;
  const c1H = iy - c1;
  parts.push(`<rect x="${CARD_X}" y="${c1}" width="${CARD_W}" height="${c1H}" rx="18" fill="#ffffff"/>`);
  parts.push(...lines1);
  y = c1 + c1H + 14;

  const c2 = y;
  const lines2: string[] = [];
  let jy = c2 + 34;
  lines2.push(text(TX, jy, "Top Outstanding Claims by Patient", { size: 20, color: BLUE, weight: 700 }));
  jy += 30;
  top.forEach((r, i) => {
    lines2.push(
      text(TX, jy, `Patient ${String.fromCharCode(65 + i)} — ${r.loc}, ${money0(r.perDay)}/day x ${r.outstanding}`, {
        size: 17,
        color: INK,
      })
    );
    lines2.push(text(W - PAD - 20, jy, money0(r.expected), { size: 17, color: INK, weight: 700, anchor: "end" }));
    jy += 28;
  });
  jy += 6;
  lines2.push(`<line x1="${TX}" y1="${jy}" x2="${W - PAD - 20}" y2="${jy}" stroke="#e3e9f2" stroke-width="1"/>`);
  jy += 24;
  lines2.push(text(TX, jy, "Total expected on outstanding claims", { size: 16, color: MUTED }));
  jy += 34;
  lines2.push(text(TX, jy, money0(censusExpected), { size: 30, color: GREEN, weight: 700 }));
  jy += 24;
  lines2.push(text(TX, jy, "Full recap in the app.", { size: 15, color: MUTED }));
  jy += 14;
  const c2H = jy - c2;
  parts.push(`<rect x="${CARD_X}" y="${c2}" width="${CARD_W}" height="${c2H}" rx="18" fill="#ffffff"/>`);
  parts.push(...lines2);
  y = c2 + c2H + 14;

  const fH = 64;
  parts.push(`<rect x="${CARD_X}" y="${y}" width="${CARD_W}" height="${fH}" rx="14" fill="#e6f4fd"/>`);
  parts.push(text(TX, y + 28, "Data this week. A stronger tomorrow.", { size: 18, color: NAVY, weight: 700 }));
  parts.push(text(TX, y + 50, "POWERED BY BC BILLING", { size: 12, color: BLUE, ls: 2 }));
  y += fH + PAD;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}">` +
    `<defs><linearGradient id="hg" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0" stop-color="${BLUE}"/><stop offset="1" stop-color="${NAVY}"/></linearGradient></defs>` +
    `<rect width="${W}" height="${y}" fill="#eef2f7"/>` +
    parts.join("") +
    `</svg>`
  );
}

export async function renderCensusPng(recap: FacilityRecap): Promise<Buffer> {
  return sharp(Buffer.from(buildCensusSvg(recap))).png().toBuffer();
}
