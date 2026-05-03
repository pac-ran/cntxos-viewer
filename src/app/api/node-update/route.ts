import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

const ALLOWED_FIELDS = new Set(["work_status", "status"]);

export async function POST(req: NextRequest) {
  const { slug, field, value } = await req.json() as {
    slug: string;
    field: string;
    value: unknown;
  };

  if (!ALLOWED_FIELDS.has(field)) {
    return NextResponse.json({ ok: false, error: "field not allowed" }, { status: 400 });
  }

  const sb = getServerSupabase();
  const { error } = await sb
    .schema("context_os")
    .rpc("admin_node_set_field", { p_slug: slug, p_field: field, p_value: value });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
