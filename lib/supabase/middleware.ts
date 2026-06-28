import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

// Refreshes the auth session on every request and protects all routes except
// /login (and static assets, handled by the matcher in middleware.ts).
export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isPublic = path === "/login" || path.startsWith("/auth");

  const toLogin = () => {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // If the deployment is missing its Supabase keys, don't crash every route
  // with a 500 — let the login page render and bounce everything else there.
  if (!supabaseUrl || !supabaseKey) {
    return isPublic ? NextResponse.next({ request }) : toLogin();
  }

  let supabaseResponse = NextResponse.next({ request });

  try {
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    });

    // IMPORTANT: do not run code between createServerClient and getUser().
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user && !isPublic) return toLogin();

    if (user && path === "/login") {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }

    return supabaseResponse;
  } catch (err) {
    // A transient auth/network failure should never take the whole site down.
    console.error("middleware updateSession error:", err);
    return isPublic ? supabaseResponse : toLogin();
  }
}
