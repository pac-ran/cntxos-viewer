import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const { slug, value, actor, prev } = await req.json() as {
    slug: string;
    value: string;
    actor: string;
    prev: string;
  };
  const sb = getServerSupabase();

  await sb
    .schema("context_os")
    .rpc("admin_node_set_field", { p_slug: slug, p_field: "work_status", p_value: value });

  // post_event — continue even if it fails
  await sb
    .schema("context_os")
    .rpc("post_event", {
      p_actor: actor,
      p_node_slug: slug,
      p_event_kind: "work_status_changed",
      p_payload: { from: prev, to: value },
    });

  return NextResponse.json({ ok: true });
}
