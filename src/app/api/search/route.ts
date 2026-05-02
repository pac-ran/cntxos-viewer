import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ results: [] });

  const sb = getServerSupabase();
  const { data } = await sb
    .schema("context_os")
    .from("nodes")
    .select("slug, node_type, status, work_status, content")
    .or(`slug.ilike.%${q}%,content.ilike.%${q}%`)
    .not("status", "eq", "archived")
    .order("updated_at", { ascending: false })
    .limit(12);

  return NextResponse.json({ results: data ?? [] });
}
