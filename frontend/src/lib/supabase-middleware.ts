import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-key",
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session if it exists
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Public routes — no redirect needed.
  // /sw.js and /manifest.json must stay reachable unauthenticated or the service
  // worker cannot register and the PWA is not installable.
  const isPublic =
    request.nextUrl.pathname === "/" ||
    request.nextUrl.pathname === "/login" ||
    request.nextUrl.pathname.startsWith("/api") ||
    request.nextUrl.pathname === "/sw.js" ||
    request.nextUrl.pathname === "/manifest.json" ||
    request.nextUrl.pathname.startsWith("/icons/");

  // If not authenticated and trying to access protected route, redirect to login
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // If authenticated and on the login page, send them to their own dashboard.
  //
  // Reads user_roles, not user_metadata: metadata is writable by the user it
  // belongs to, so it cannot decide anything that matters. An unknown role falls
  // through to the patient portal, and RLS still governs what data loads.
  if (user && request.nextUrl.pathname === "/login") {
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    const allowed = ["patient", "doctor", "admin", "asha"];
    const role = allowed.includes(data?.role) ? data!.role : "patient";

    const url = request.nextUrl.clone();
    url.pathname = `/${role}/dashboard`;
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
