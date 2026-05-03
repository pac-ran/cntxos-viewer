import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

export async function GET() {
  const sb = getServerSupabase();
  const { data, error } = await sb
    .schema("context_os")
    .rpc("get_agent_session", { p_agent_slug: "randy" });
  if (error || data === null) return NextResponse.json({ node: null });
  return NextResponse.json({ node: { payload: data } });
}
