// Proxy for Supabase edge-function-served HTML surfaces.
// Supabase applies CSP `default-src 'none'; sandbox` to public edge function
// GET responses, which blocks browser rendering as a webpage even when
// Content-Type is text/html. This route fetches the edge function body
// and re-emits with clean headers so set_pane(type='url', ref='/api/surface/X')
// works in the viewer's iframe.
//
// Per AC2 ac2-surface-poc + Randy 2026-05-12 fallback pattern.

import { NextRequest, NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (!SUPABASE_URL) {
    return new NextResponse("NEXT_PUBLIC_SUPABASE_URL not configured", { status: 500 });
  }
  // Pass through query string so the edge function can read its own params
  const qs = req.nextUrl.search ?? "";
  const upstream = `${SUPABASE_URL}/functions/v1/${encodeURIComponent(name)}${qs}`;
  const headers: Record<string, string> = {};
  if (ANON_KEY) headers["Authorization"] = `Bearer ${ANON_KEY}`;

  const res = await fetch(upstream, { headers, method: "GET" });
  const body = await res.text();
  const contentType = res.headers.get("content-type") ?? "text/html; charset=utf-8";
  // Strip Supabase's CSP + content-type override. Re-emit body with clean
  // headers. ALLOWALL so the viewer can iframe it.
  return new NextResponse(body, {
    status: res.status,
    headers: {
      "Content-Type": contentType.includes("text/plain") ? "text/html; charset=utf-8" : contentType,
      "X-Frame-Options": "ALLOWALL",
      "Cache-Control": "no-store",
    },
  });
}
