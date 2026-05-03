import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

const ALLOWED_VALUES = new Set(["draft", "review", "canon", "archived", "deferred"]);

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

  try {
    await sb.rpc("admin_post_event", {
      p_actor: actor,
      p_slug: slug,
      p_kind: value === "archived" ? "archived" : value === "review" ? "review" : "node-edited",
      p_payload: { to: value },
    });
  } catch (err) {
    console.error("admin_post_event failed:", err);
  }

  return NextResponse.json({ ok: true });
}
