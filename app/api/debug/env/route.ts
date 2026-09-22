import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Diagnostic ONLY. Reports whether specific server env vars are present at
// runtime — booleans and key NAMES, never the secret values. Management-only.
// Used to confirm the running service actually received the Square config after
// a Render Blueprint / dashboard change. Safe to leave in: it leaks no secrets.
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (me?.role !== "management")
    return NextResponse.json({ error: "Management only" }, { status: 403 });

  const present = (k: string) => {
    const v = process.env[k];
    return typeof v === "string" && v.trim().length > 0;
  };

  // Every env var name the runtime sees that mentions Square / Twilio — catches
  // typos or stray whitespace in the KEY itself (e.g. "TWILIO_ACCOUNT_SID " with
  // a trailing space, which would make process.env.TWILIO_ACCOUNT_SID undefined).
  const namesLike = (needle: string) =>
    Object.keys(process.env)
      .filter((k) => k.toUpperCase().includes(needle))
      .sort();

  return NextResponse.json({
    SQUARE_ACCESS_TOKEN: present("SQUARE_ACCESS_TOKEN"),
    SQUARE_LOCATION_ID: present("SQUARE_LOCATION_ID"),
    SQUARE_ENV: process.env.SQUARE_ENV ?? null,
    // Twilio (SMS). FROM is just a phone number, not a secret — shown to verify.
    TWILIO_ACCOUNT_SID: present("TWILIO_ACCOUNT_SID"),
    TWILIO_AUTH_TOKEN: present("TWILIO_AUTH_TOKEN"),
    TWILIO_FROM: process.env.TWILIO_FROM ?? null,
    twilioKeyNamesSeen: namesLike("TWILIO"),
    // Sanity check that OTHER server secrets are reaching this same runtime.
    RESEND_API_KEY: present("RESEND_API_KEY"),
    SUPABASE_SERVICE_ROLE_KEY: present("SUPABASE_SERVICE_ROLE_KEY"),
    squareKeyNamesSeen: namesLike("SQUARE"),
  });
}
