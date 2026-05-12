import { NextResponse, type NextRequest } from "next/server";
import { verifyOperatorToken } from "@/lib/auth-token";

// GET-only routes — no write capability, pass through
const PUBLIC_API_PATHS = [
  "/api/cx-surface/",
  "/api/cx-walk/",
  "/api/cx-walk-events",
  "/api/cx-walk-stream/",
  "/api/frame-state",
  "/api/node/session-randy",
  "/api/search",
  // Broker chat: actor-scoped DeepSeek SSE proxy. POST-only. The actor in
  // the request body keys persistence; no cross-actor leakage. Same-origin
  // from viewer iframe; no cookie required so the iframe Just Works.
  "/api/broker/chat",
  // Broker sessions: per-actor session list + create/fork/rename/archive.
  // Mutations are actor-scoped and slug-prefixed; same trust model as chat.
  "/api/broker/sessions",
  "/api/broker/messages",
  // LEFT-pane CRUD (Randy 2026-05-09): create/update/delete/search.
  // Same trust model as broker chat — same-origin from viewer iframe;
  // input is regex-validated and routed through SECURITY DEFINER RPCs.
  "/api/node/search",
  "/api/node/create",
  "/api/node/update",
  "/api/node/delete",
  // Surface proxy (Randy 2026-05-12): /api/surface/[name] is a CSP-stripping
  // passthrough for Supabase edge functions. The edge function IS the
  // security boundary (verify_jwt + own auth). Proxy must be unauthenticated
  // so iframes can load it cross-subdomain (cntxos.com → viewer.cntxos.com)
  // without carrying a session cookie. Proxy doesn't read auth state and
  // only fetches public edge function URLs.
  "/api/surface/",
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
