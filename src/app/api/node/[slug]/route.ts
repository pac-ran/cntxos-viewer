import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

const R2_PUBLIC_URL =
  process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? "https://media.pacificstyle.net";

function resolveR2Urls(content: string | null): string | null {
  if (!content) return content;
  return content.replace(/r2:\/\/psos-assets\//g, `${R2_PUBLIC_URL}/`);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const sb = getServerSupabase();

  // Node first — 404 fast if missing
  const { data: node, error } = await sb
    .schema("context_os")
    .from("nodes")
    .select("id,slug,node_type,status,work_status,content,tags,scope,payload,visibility")
    .eq("slug", slug)
    .single();

  if (error || !node) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const nodeType = (node as { node_type: string }).node_type;
  const nodeId = (node as { id: string }).id;

  // Events, action manifest, tags vocab — all parallel
  const [eventsResult, manifestResult, tagRowsResult] = await Promise.all([
    sb.schema("context_os").rpc("node_activity", { p_node_slug: slug, p_limit: 5 }),
    sb.schema("context_os").from("nodes").select("content").eq("slug", `actions-for-${nodeType}`).maybeSingle(),
    sb.schema("context_os").from("nodes").select("tags").not("tags", "is", null).limit(500),
  ]);

  // Events — RPC fallback to direct query
  let events: unknown[] = [];
  if (Array.isArray(eventsResult.data)) {
    events = eventsResult.data;
  } else {
    const { data: evDirect } = await sb
      .schema("context_os")
      .from("events")
      .select("event_kind,actor,occurred_at,outcome")
      .eq("subject_node_id", nodeId)
      .order("occurred_at", { ascending: false })
      .limit(5);
    events = evDirect ?? [];
  }

  // Tags vocab
  let tagsVocab: string[] = [];
  if (Array.isArray(tagRowsResult.data)) {
    const seen = new Set<string>();
    for (const row of tagRowsResult.data as { tags: string[] | null }[]) {
      for (const t of row.tags ?? []) seen.add(t);
      if (seen.size >= 100) break;
    }
    tagsVocab = [...seen].sort();
  }

  const resolvedNode = {
    ...node,
    content: resolveR2Urls((node as { content: string | null }).content),
  };

  return NextResponse.json({
    node: resolvedNode,
    events,
    actionManifest: (manifestResult.data as { content?: string } | null)?.content ?? null,
    tagsVocab,
  });
}
