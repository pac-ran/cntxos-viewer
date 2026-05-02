import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const { slug, actor } = await req.json() as { slug: string; actor: string };
  const sb = getServerSupabase();
  const { data, error } = await sb
    .schema("context_os")
    .rpc("crud_form_archive", { p_actor: actor, p_slug: slug });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
