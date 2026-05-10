// /api/broker/messages?slug=conv-broker-randy
//
// Returns chat events for a broker session, oldest-first, as a list of
// {role, content, model?, usage?} entries. Used by ChatPane to rehydrate
// when a user switches between sessions.

import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface MessageRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
  usage?: Record<string, number>;
  created_at: string;
}

export async function GET(req: NextRequest) {
  const slug = new URL(req.url).searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });

  const sb = getServerSupabase();
  const { data: node } = await sb
    .schema("context_os")
    .from("nodes")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (!node) return NextResponse.json({ messages: [] });

  const { data: events } = await sb
    .schema("context_os")
    .from("events")
    .select("id, payload, occurred_at, event_kind")
    .eq("subject_node_id", node.id as string)
    .order("occurred_at", { ascending: true });

  const messages: MessageRow[] = [];
  for (const ev of events ?? []) {
    if (ev.event_kind !== "message") continue;
    const p = (ev.payload ?? {}) as Record<string, unknown>;
    const role = p.role as string | undefined;
    if (role !== "user" && role !== "assistant") continue;
    messages.push({
      id: ev.id as string,
      role,
      content: (p.content as string) ?? "",
      model: p.model as string | undefined,
      usage: p.usage as Record<string, number> | undefined,
      created_at: ev.occurred_at as string,
    });
  }

  return NextResponse.json({ messages });
}
