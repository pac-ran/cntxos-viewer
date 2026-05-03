import { NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

interface NodeRow {
  id: string;
  slug: string;
  node_type: string;
}

interface LinkRow {
  from_node_id: string;
  to_node_id: string;
  relation_type: string;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const slug = searchParams.get("slug");
  if (!slug) {
    return new Response(JSON.stringify({ error: "slug required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const relationTypes = searchParams.get("relation_type")?.split(",") ?? ["implements"];
  const direction = searchParams.get("direction") ?? "both";
  const maxDepth = Math.min(parseInt(searchParams.get("max_depth") ?? "6", 10), 10);

  const sb = getServerSupabase();

  // Resolve starting node
  const { data: startNode } = await sb
    .schema("context_os")
    .from("nodes")
    .select("id,slug,node_type")
    .eq("slug", slug)
    .single();

  if (!startNode) {
    return new Response(JSON.stringify({ error: "node not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const visitedIds = new Set<string>([startNode.id]);
      const allNodes: NodeRow[] = [startNode as NodeRow];
      const allEdges: Array<{ from: string; to: string; relation: string }> = [];
      let currentLevel = [startNode.id];

      // Depth 0 — emit the starting node
      emit({ depth: 0, new_nodes: [{ slug: startNode.slug, node_type: startNode.node_type }], total_nodes: 1, edges: [] });

      for (let depth = 1; depth <= maxDepth; depth++) {
        if (req.signal.aborted) break;
        if (currentLevel.length === 0) break;

        // Fetch links — for "both", do two queries and merge
        type DirectedLink = { sourceId: string; targetId: string; relation: string };
        const directedLinks: DirectedLink[] = [];

        if (direction === "forward" || direction === "both") {
          let q = sb.schema("context_os").from("links").select("from_node_id,to_node_id,relation_type").in("from_node_id", currentLevel);
          if (relationTypes.length > 0 && !relationTypes.includes("all")) q = q.in("relation_type", relationTypes);
          const { data } = await q;
          for (const l of (data ?? []) as LinkRow[]) {
            directedLinks.push({ sourceId: l.from_node_id, targetId: l.to_node_id, relation: l.relation_type });
          }
        }
        if (direction === "backward" || direction === "both") {
          let q = sb.schema("context_os").from("links").select("from_node_id,to_node_id,relation_type").in("to_node_id", currentLevel);
          if (relationTypes.length > 0 && !relationTypes.includes("all")) q = q.in("relation_type", relationTypes);
          const { data } = await q;
          for (const l of (data ?? []) as LinkRow[]) {
            directedLinks.push({ sourceId: l.to_node_id, targetId: l.from_node_id, relation: l.relation_type });
          }
        }

        if (directedLinks.length === 0) break;

        // Collect new node IDs
        const newIds = new Set<string>();
        const newEdges: Array<{ from: string; to: string; relation: string }> = [];

        for (const link of directedLinks) {
          const sourceNode = allNodes.find(n => n.id === link.sourceId);
          const sourceSlug = sourceNode?.slug ?? link.sourceId;

          if (!visitedIds.has(link.targetId)) {
            newIds.add(link.targetId);
            visitedIds.add(link.targetId);
          }

          newEdges.push({ from: sourceSlug, to: link.targetId, relation: link.relation });
        }

        if (newIds.size === 0) break;

        // Resolve new node IDs to slugs
        const { data: newNodeRows } = await sb
          .schema("context_os")
          .from("nodes")
          .select("id,slug,node_type")
          .in("id", [...newIds]);

        const newNodes = (newNodeRows ?? []) as NodeRow[];
        allNodes.push(...newNodes);

        // Resolve edge targets to slugs now that we have them
        const resolvedEdges = newEdges.map(e => {
          const targetNode = allNodes.find(n => n.id === e.to);
          return { from: e.from, to: targetNode?.slug ?? e.to, relation: e.relation };
        }).filter(e => e.from !== e.to);

        allEdges.push(...resolvedEdges);
        currentLevel = [...newIds];

        await new Promise(r => setTimeout(r, 200));
        if (req.signal.aborted) break;

        emit({
          depth,
          new_nodes: newNodes.map(n => ({ slug: n.slug, node_type: n.node_type })),
          total_nodes: allNodes.length,
          edges: resolvedEdges,
        });
      }

      emit({ done: true, total_nodes: allNodes.length });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
