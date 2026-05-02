import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const { slug, actor, event_kind, payload } = await req.json() as {
    slug: string;
    actor: string;
    event_kind: string;
    payload: Record<string, unknown>;
  };
  const sb = getServerSupabase();
  const { data, error } = await sb
    .rpc("admin_post_event", {
      p_actor: actor,
      p_slug: slug,
      p_kind: event_kind,
      p_payload: payload,
    });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}
