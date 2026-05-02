import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

export async function GET() {
  const sb = getServerSupabase();
  const { data } = await sb
    .schema("context_os")
    .from("nodes")
    .select("payload")
    .eq("slug", "conv-frame-state")
    .single();
  const payload = data?.payload as { slots?: unknown[] } | null;
  return NextResponse.json({ slots: payload?.slots ?? [] });
}
