// POST /api/node/delete
//
// Body: { slug: string, confirm: true, actor?: string }
// Returns { ok: true } on success, { ok: false, error } on failure.
// Hard-deletes the node and its dependent events.

import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

interface DeleteBody { slug?: string; confirm?: boolean; actor?: string }

export async function POST(req: NextRequest) {
  let body: DeleteBody;
  try { body = await req.json() as DeleteBody; }
  catch { return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 }); }

  const slug = (body.slug ?? "").trim();
  if (!slug) return NextResponse.json({ ok: false, error: "slug required" }, { status: 400 });
  if (body.confirm !== true) {
    return NextResponse.json({ ok: false, error: "confirm: true required for delete" }, { status: 400 });
  }

  const sb = getServerSupabase();
  const { error } = await sb.rpc("admin_node_delete", { p_slug: slug });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
