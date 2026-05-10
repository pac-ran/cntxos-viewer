import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

// Per-user resolution: ?actor=randy → conv-frame-state-randy
// Falls back to shared conv-frame-state if no actor or unknown actor.
const KNOWN_ACTORS = new Set(["randy", "nancy"]);
function resolveConvSlug(actor: string | null): string {
  if (actor && KNOWN_ACTORS.has(actor)) return `conv-frame-state-${actor}`;
  return "conv-frame-state";
}

export async function GET(req: NextRequest) {
  const sb = getServerSupabase();
  const actor = new URL(req.url).searchParams.get("actor");
  const slug = resolveConvSlug(actor);

  const { data: node } = await sb
    .schema("context_os")
    .from("nodes")
    .select("id, payload")
    .eq("slug", slug)
    .single();

  if (!node) return NextResponse.json({ slots: [], conv_slug: slug, conv_id: null });

  const payloadSlots = (node.payload as { slots?: unknown[] } | null)?.slots;
  if (Array.isArray(payloadSlots) && payloadSlots.length > 0) {
    return NextResponse.json({ slots: payloadSlots, conv_slug: slug, conv_id: (node as { id: string }).id });
  }

  const { data: events } = await sb
    .schema("context_os")
    .from("events")
    .select("payload")
    .eq("subject_node_id", (node as { id: string }).id)
    .eq("event_kind", "frame-update")
    .order("occurred_at", { ascending: false })
    .limit(1);

  const slots = (events?.[0]?.payload as { slots?: unknown[] } | null)?.slots ?? [];
  return NextResponse.json({ slots, conv_slug: slug, conv_id: (node as { id: string }).id });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const left_slug = typeof body.left_slug === "string" ? body.left_slug : null;
  const actor = typeof body.actor === "string" ? body.actor : null;
  if (!left_slug) return NextResponse.json({ error: "left_slug required" }, { status: 400 });

  const slug = resolveConvSlug(actor);

  const sb = getServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb.schema("context_os") as any).rpc("admin_node_set_payload", {
    p_slug: slug,
    p_payload_patch: { left_slug },
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, conv_slug: slug, result: data });
}
