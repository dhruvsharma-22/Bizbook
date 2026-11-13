import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/supabase/database.types";
import { getAuthGateDecision } from "@/lib/supabase/auth-gate";

const AUTH_COOKIE_PATTERN = /^sb-.+-auth-token(?:\.\d+)?$/;

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  const hasSessionCookie = request.cookies
    .getAll()
    .some(({ name }) => AUTH_COOKIE_PATTERN.test(name));
  const authGateDecision = getAuthGateDecision(
    request.nextUrl.pathname,
    Boolean(url && publishableKey),
  );

  // Public sign-in and checkout-link routes can explain missing configuration.
  // Protected application routes must fail closed in every environment.
  if (!url || !publishableKey) {
    if (authGateDecision === "allow-public") {
      return NextResponse.next({ request });
    }

    return NextResponse.json(
      { error: "BizBook authentication is not configured." },
      { status: 503 },
    );
  }

  if (authGateDecision === "allow-public") {
    return NextResponse.next({ request });
  }

  const denyUnauthenticated = () => {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set(
      "next",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return NextResponse.redirect(loginUrl);
  };

  if (!hasSessionCookie) return denyUnauthenticated();

  let response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) return denyUnauthenticated();
  } catch {
    return denyUnauthenticated();
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!api/webhooks/|api/payments/webhook|api/cron/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

