import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const agent = req.nextUrl.searchParams.get("agent");
  if (!agent) {
    return NextResponse.json({ error: "agent param required" }, { status: 400 });
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: "context_os" } }
  );

  const agentSlug = `agent-${agent}`;

  // All 5 queries in parallel
  const [tasksResult, eventsResult, agentNodeResult, directivesResult, inboxResult] = await Promise.all([
    // 1. Current tasks (ready or in-progress, claimed by this agent)
    sb.from("nodes")
      .select("slug, content, work_status, payload")
      .in("work_status", ["ready", "in-progress"])
      .eq("claimed_by", agent)
      .eq("node_type", "task"),

    // 2. Recent events (last 20, newest first)
    sb.from("events")
      .select("event_kind, actor, outcome, occurred_at, payload, subject_node_id")
      .order("occurred_at", { ascending: false })
      .limit(20),

    // 3. Agent identity node
    sb.from("nodes")
      .select("slug, content, payload, updated_at")
      .eq("slug", agentSlug)
      .single(),

    // 4. Active directives (policies + practices, canon, scoped to root.cntxos)
    sb.from("nodes")
      .select("slug, content")
      .in("node_type", ["policy", "practice"])
      .eq("status", "canon")
      .like("scope", "root.cntxos.%")
      .limit(10),

    // 5. Inbox count for this agent
    sb.from("nodes")
      .select("slug", { count: "exact", head: true })
      .eq("node_type", "task")
      .eq("work_status", "inbox")
      .eq("claimed_by", agent),
  ]);

  return NextResponse.json({
    tasks: tasksResult.data ?? [],
    recent_events: eventsResult.data ?? [],
    agent_node: agentNodeResult.data ?? null,
    active_directives: directivesResult.data ?? [],
    inbox_count: inboxResult.count ?? 0,
    generated_at: new Date().toISOString(),
  });
}
