// POST /api/node/update
//
// Body: { slug: string, patch: { content?, scope?, status?, visibility?,
//                                 node_type?, tags?: string[], payload?: object },
//         actor?: string }
//
// Returns { ok: true } on success, { ok: false, error } on failure.

import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

interface UpdateBody {
  slug?: string;
  patch?: Record<string, unknown>;
  actor?: string;
}

const ALLOWED_PATCH_KEYS = new Set([
  "content", "scope", "status", "visibility", "node_type", "tags", "payload",
]);

export async function POST(req: NextRequest) {
  let body: UpdateBody;
  try { body = await req.json() as UpdateBody; }
  catch { return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 }); }

  const slug = (body.slug ?? "").trim();
  if (!slug) return NextResponse.json({ ok: false, error: "slug required" }, { status: 400 });
  if (!body.patch || typeof body.patch !== "object") {
    return NextResponse.json({ ok: false, error: "patch required" }, { status: 400 });
  }

  // Filter to allowed keys only — defense in depth.
  const cleanPatch: Record<string, unknown> = {};
  for (const k of Object.keys(body.patch)) {
    if (ALLOWED_PATCH_KEYS.has(k)) cleanPatch[k] = body.patch[k];
  }
  if (Object.keys(cleanPatch).length === 0) {
    return NextResponse.json({ ok: false, error: "no editable fields in patch" }, { status: 400 });
  }

  const sb = getServerSupabase();
  const { error } = await sb.rpc("admin_node_update", {
    p_slug: slug,
    p_patch: cleanPatch,
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  // Best-effort updated event.
  const actor = (body.actor ?? "").trim() || "viewer";
  try {
    await sb.rpc("admin_post_event", {
      p_actor: actor,
      p_slug: slug,
      p_kind: "updated",
      p_payload: { fields: Object.keys(cleanPatch) },
      p_outcome: null,
    });
  } catch { /* non-critical */ }

  return NextResponse.json({ ok: true });
}
