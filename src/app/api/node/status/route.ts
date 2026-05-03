import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

const ALLOWED_VALUES = new Set(["draft", "canon", "archived"]);

export async function POST(req: NextRequest) {
  const { slug, value, actor } = await req.json() as {
    slug: string;
    value: string;
    actor: string;
  };

  if (!ALLOWED_VALUES.has(value)) {
    return NextResponse.json({ ok: false, error: "invalid status value" }, { status: 400 });
  }

  const sb = getServerSupabase();

  await sb
    .schema("context_os")
    .rpc("admin_node_set_field", { p_slug: slug, p_field: "status", p_value: value });

  await sb.rpc("admin_post_event", {
    p_actor: actor,
    p_slug: slug,
    p_kind: value === "canon" ? "promoted-to-canon" : "status-changed",
    p_payload: { to: value },
  });

  return NextResponse.json({ ok: true });
}
