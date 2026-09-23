import { NextResponse } from "next/server";

// Public, secret-free deploy check. Returns the git commit the running service
// was built from (Render sets RENDER_GIT_COMMIT) plus when this instance booted,
// so a deploy can be confirmed as Live without digging through the dashboard.
// A commit SHA is not sensitive. No auth on purpose.
export const dynamic = "force-dynamic";

const BOOTED_AT = new Date().toISOString();

export function GET() {
  const commit = process.env.RENDER_GIT_COMMIT || null;
  return NextResponse.json({
    commit,
    commitShort: commit ? commit.slice(0, 7) : null,
    branch: process.env.RENDER_GIT_BRANCH || null,
    bootedAt: BOOTED_AT,
    now: new Date().toISOString(),
  });
}
