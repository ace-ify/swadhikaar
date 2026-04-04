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

  // Public routes — no redirect needed
  const isPublic =
    request.nextUrl.pathname === "/" ||
    request.nextUrl.pathname === "/login" ||
    request.nextUrl.pathname.startsWith("/api");

  // If not authenticated and trying to access protected route, redirect to login
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // If authenticated and on login page, redirect to their dashboard
  if (user && request.nextUrl.pathname === "/login") {
    const role = (user.user_metadata?.role as string) || "patient";
    const url = request.nextUrl.clone();
    url.pathname = `/${role === "doctor" ? "doctor" : role}/dashboard`;
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
