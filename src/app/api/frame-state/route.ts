import { NextRequest, NextResponse } from "next/server";
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

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const left_slug = typeof body.left_slug === "string" ? body.left_slug : null;
  if (!left_slug) return NextResponse.json({ error: "left_slug required" }, { status: 400 });

  const sb = getServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb.schema("context_os") as any).rpc("admin_node_set_payload", {
    p_slug: "conv-frame-state",
    p_payload_patch: { left_slug },
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, result: data });
}
