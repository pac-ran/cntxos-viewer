import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

export async function GET() {
  const sb = getServerSupabase();

  const { data: node } = await sb
    .schema("context_os")
    .from("nodes")
    .select("id, payload")
    .eq("slug", "conv-frame-state")
    .single();

  if (!node) return NextResponse.json({ slots: [] });

  // Prefer payload.slots if persisted directly on the node
  const payloadSlots = (node.payload as { slots?: unknown[] } | null)?.slots;
  if (Array.isArray(payloadSlots) && payloadSlots.length > 0) {
    return NextResponse.json({ slots: payloadSlots });
  }

  // Fall back to latest frame-update event (DL drives via events, not payload)
  const { data: events } = await sb
    .schema("context_os")
    .from("events")
    .select("payload")
    .eq("subject_node_id", (node as { id: string }).id)
    .eq("event_kind", "frame-update")
    .order("occurred_at", { ascending: false })
    .limit(1);

  const slots = (events?.[0]?.payload as { slots?: unknown[] } | null)?.slots ?? [];
  return NextResponse.json({ slots });
}
