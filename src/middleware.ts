import { NextResponse, type NextRequest } from "next/server";
import { verifyOperatorToken } from "@/lib/auth-token";

// GET-only routes — no write capability, pass through
const PUBLIC_API_PATHS = [
  "/api/cx-surface/",
  "/api/cx-walk-events",
  "/api/cx-walk-stream/",
  "/api/node/session-randy",
  "/api/search",
];

function isPublicApi(pathname: string): boolean {
  // GET-only node read — explicitly exclude all write sub-routes
  if (pathname.match(/^\/api\/node\/[^/]+$/) &&
      !pathname.includes("/save") &&
      !pathname.includes("/tags") &&
      !pathname.includes("/archive") &&
      !pathname.includes("/status") &&
      !pathname.includes("/work-status") &&
      !pathname.includes("/event")) {
    return true;
  }
  return PUBLIC_API_PATHS.some((p) => pathname.startsWith(p));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Static assets — always pass through
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname.endsWith(".ico") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".svg")
  ) {
    return NextResponse.next();
  }

  // Non-API routes (page renders) — pass through
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Public read-only API routes — pass through
  if (isPublicApi(pathname)) {
    return NextResponse.next();
  }

  // AUTH_SECRET not configured — dev mode, pass through
  // Production: AUTH_SECRET must be set in Vercel env vars
  if (!process.env.AUTH_SECRET) {
    return NextResponse.next();
  }

  // Require cntxos-auth cookie on write API routes
  const rawToken = request.cookies.get("cntxos-auth")?.value;
  if (rawToken) {
    const operatorSlug = await verifyOperatorToken(rawToken);
    if (operatorSlug) {
      const response = NextResponse.next();
      response.headers.set("x-operator-slug", operatorSlug);
      return response;
    }
  }

  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
