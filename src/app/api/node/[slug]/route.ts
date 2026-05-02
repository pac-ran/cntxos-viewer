import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const sb = getServerSupabase();

  // Node
  const { data: node, error } = await sb
    .schema("context_os")
    .from("nodes")
    .select("id,slug,node_type,status,work_status,content,tags,scope,payload,visibility")
    .eq("slug", slug)
    .single();

  if (error || !node) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Events — node_activity RPC, fallback to direct query
  let events: unknown[] = [];
  const { data: actData } = await sb
    .schema("context_os")
    .rpc("node_activity", { p_node_slug: slug, p_limit: 5 });
  if (Array.isArray(actData)) {
    events = actData;
  } else {
    const { data: evDirect } = await sb
      .schema("context_os")
      .from("events")
      .select("event_kind,actor,occurred_at,outcome")
      .eq("subject_node_id", (node as { id: string }).id)
      .order("occurred_at", { ascending: false })
      .limit(5);
    events = evDirect ?? [];
  }

  // Action manifest
  const { data: manifestData } = await sb
    .schema("context_os")
    .from("nodes")
    .select("content")
    .eq("slug", `actions-for-${(node as { node_type: string }).node_type}`)
    .maybeSingle();

  // Tags vocab — flatten tags arrays from a sample of nodes
  let tagsVocab: string[] = [];
  const { data: tagRows } = await sb
    .schema("context_os")
    .from("nodes")
    .select("tags")
    .not("tags", "is", null)
    .limit(500);
  if (Array.isArray(tagRows)) {
    const seen = new Set<string>();
    for (const row of tagRows as { tags: string[] | null }[]) {
      for (const t of row.tags ?? []) seen.add(t);
      if (seen.size >= 100) break;
    }
    tagsVocab = [...seen].sort();
  }

  return NextResponse.json({
    node,
    events,
    actionManifest: (manifestData as { content?: string } | null)?.content ?? null,
    tagsVocab,
  });
}
