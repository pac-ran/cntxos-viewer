/**
 * POST /api/cx-event
 *
 * Viewer-side proxy for posting events to the substrate.
 * Accepts event_kind, proposal_id, and actor from the approval-queue
 * surface buttons and calls the Supabase admin_post_event RPC directly
 * using the service role key (server-side only).
 *
 * Body: { event_kind, proposal_id, actor?, node_slug? }
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const ALLOWED_EVENT_KINDS = new Set([
  "proposal-approved",
  "proposal-denied",
]);

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event_kind = body.event_kind as string | undefined;
  const proposal_id = body.proposal_id as string | undefined;
  const actor = (body.actor as string | undefined) ?? "cc";

  if (!event_kind) {
    return NextResponse.json({ error: "event_kind is required" }, { status: 400 });
  }
  if (!ALLOWED_EVENT_KINDS.has(event_kind)) {
    return NextResponse.json({ error: `event_kind '${event_kind}' not allowed via this endpoint` }, { status: 400 });
  }
  if (!proposal_id) {
    return NextResponse.json({ error: "proposal_id is required" }, { status: 400 });
  }

  const sb = getServerSupabase();

  // Post event directly via Supabase RPC. We use a sentinel slug
  // (the admin surface slug) as the subject node since proposal events
  // are anchored to subject nodes but approval-queue actions don't need
  // a specific target beyond the proposal_id in the payload.
  const { data, error } = await sb.rpc("admin_post_event", {
    p_actor: actor,
    p_slug: "s-admin-approval-queue",
    p_kind: event_kind,
    p_payload: { proposal_id, actor },
    p_outcome: null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const eventId = (data as Record<string, unknown> | null)?.event_id as string | undefined;
  return NextResponse.json({ ok: true, event_id: eventId });
}
