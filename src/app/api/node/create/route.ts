// POST /api/node/create
//
// Body: {
//   slug:        string (required, ^[a-z0-9-]+$)
//   node_type:   string (required)
//   scope:       string (required, ltree path like "root.cntxos.workspace.randy")
//   title?:      string  → folded into payload.title
//   content?:    string
//   tags?:       string[]
//   visibility?: "public" | "private"  (default "private")
//   status?:     "draft" | "canon"     (default "draft")
//   payload?:    Record<string, unknown>
//   actor?:      string  (records who created the node — best-effort event)
// }
// Returns: { ok: true, slug } on success, { ok: false, error } on failure.

import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

interface CreateBody {
  slug?: string;
  node_type?: string;
  scope?: string;
  title?: string;
  content?: string;
  tags?: string[];
  visibility?: string;
  status?: string;
  payload?: Record<string, unknown>;
  actor?: string;
}

export async function POST(req: NextRequest) {
  let body: CreateBody;
  try { body = await req.json() as CreateBody; }
  catch { return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 }); }

  const slug = (body.slug ?? "").trim();
  const node_type = (body.node_type ?? "").trim();
  const scope = (body.scope ?? "").trim();
  const visibility = body.visibility === "public" ? "public" : "private";
  const status = body.status === "canon" ? "canon" : "draft";

  if (!slug || !SLUG_RE.test(slug)) {
    return NextResponse.json({ ok: false, error: "invalid slug (use lowercase letters, digits, dashes)" }, { status: 400 });
  }
  if (!node_type) {
    return NextResponse.json({ ok: false, error: "node_type required" }, { status: 400 });
  }
  if (!scope) {
    return NextResponse.json({ ok: false, error: "scope required" }, { status: 400 });
  }

  const payload: Record<string, unknown> = { ...(body.payload ?? {}) };
  if (body.title && typeof body.title === "string" && body.title.trim()) {
    payload.title = body.title.trim();
  }

  const tags = Array.isArray(body.tags)
    ? body.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean)
    : [];

  const sb = getServerSupabase();
  const { data, error } = await sb.rpc("admin_create_node", {
    p_slug: slug,
    p_node_type: node_type,
    p_scope: scope,
    p_payload: payload,
    p_content: body.content ?? null,
    p_tags: tags,
    p_visibility: visibility,
    p_status: status,
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  // Best-effort created event.
  const actor = (body.actor ?? "").trim() || "viewer";
  try {
    await sb.rpc("admin_post_event", {
      p_actor: actor,
      p_slug: slug,
      p_kind: "created",
      p_payload: { node_type, scope },
      p_outcome: null,
    });
  } catch { /* non-critical */ }

  return NextResponse.json({ ok: true, slug, result: data });
}
