import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const sb = getServerSupabase();
  const { data, error } = await sb
    .schema("context_os")
    .rpc("admin_stake_contact", {
      p_name:    name,
      p_company: String(body.company ?? "").trim(),
      p_email:   String(body.email ?? "").trim(),
      p_phone:   String(body.phone ?? "").trim(),
      p_source:  String(body.source ?? "manual").trim(),
      p_notes:   String(body.notes ?? "").trim(),
      p_tags:    Array.isArray(body.tags) ? (body.tags as string[]).map(String) : [],
    });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data as { ok: boolean; slug: string });
}
