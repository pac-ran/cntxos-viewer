// GET /api/node/search?q=...&actor=...&types=document,task&scopes=root.cntxos&include_archived=1
//
// Public read-only search across context_os.nodes. Returns up to 20 matches
// by slug ILIKE, content ILIKE, or tag overlap. Excludes archived nodes
// unless include_archived=1 is passed.
//
// Response shape:
//   { results: { slug, node_type, scope, status, snippet }[] }

import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

interface NodeRow {
  slug: string;
  node_type: string;
  scope: unknown;
  status: string;
  content: string | null;
  tags: string[] | null;
  payload: { title?: string } | null;
  updated_at: string;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const q = (params.get("q") ?? "").trim();
  const types = (params.get("types") ?? "")
    .split(",").map(s => s.trim()).filter(Boolean);
  const scopes = (params.get("scopes") ?? "")
    .split(",").map(s => s.trim()).filter(Boolean);
  const includeArchived = params.get("include_archived") === "1";

  if (q.length < 2) return NextResponse.json({ results: [] });

  // Defensive escaping for ILIKE pattern. Underscore + percent + backslash.
  const safe = q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

  const sb = getServerSupabase();
  let query = sb
    .schema("context_os")
    .from("nodes")
    .select("slug,node_type,scope,status,content,tags,payload,updated_at")
    .or(`slug.ilike.%${safe}%,content.ilike.%${safe}%,tags.cs.{${q}}`)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (!includeArchived) query = query.not("status", "eq", "archived");
  if (types.length > 0) query = query.in("node_type", types);
  if (scopes.length > 0) {
    // Match any scope that begins with one of the provided prefixes.
    const orParts = scopes.map(s => `scope.like.${s}*`).join(",");
    query = query.or(orParts);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message, results: [] }, { status: 500 });
  }

  const results = (data as NodeRow[] ?? []).map(r => {
    const title = r.payload?.title;
    const snippetSrc = title ?? r.content ?? "";
    return {
      slug: r.slug,
      node_type: r.node_type,
      scope: String(r.scope ?? ""),
      status: r.status,
      snippet: snippetSrc.slice(0, 60),
    };
  });

  return NextResponse.json({ results });
}
