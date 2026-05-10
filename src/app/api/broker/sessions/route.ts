// /api/broker/sessions
//
// Manages per-actor chat session conversation nodes (slug pattern:
// `conv-broker-{actor}` or `conv-broker-{actor}-{ulid}`).
//
// GET ?actor=randy → list non-archived sessions for actor, ordered by most
//   recent activity (last event ts, falling back to created_at).
// POST { actor, action, source_slug?, target_slug?, new_title? } where
//   action ∈ "new" | "fork" | "rename" | "archive".
//
// Response shape: { sessions: [{slug, title, last_message_at, message_count}] }
// or { slug, title, ... } for single-session mutations.

import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface SessionRow {
  slug: string;
  title: string;
  created_at: string;
  last_message_at: string | null;
  message_count: number;
}

function makeUlidish(): string {
  // Sortable-ish 12-char id; ulid lib not installed, this is sufficient.
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function defaultSlug(actor: string): string {
  return `conv-broker-${actor}`;
}

function newSlug(actor: string): string {
  return `conv-broker-${actor}-${makeUlidish()}`;
}

async function ensureDefaultNode(actor: string) {
  const sb = getServerSupabase();
  const slug = defaultSlug(actor);
  const { data: existing } = await sb
    .schema("context_os")
    .from("nodes")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (existing) return;
  await sb.rpc("admin_create_broker_session", {
    p_slug: slug,
    p_content: `Broker chat conversation for ${actor}`,
    p_payload: {
      actor,
      kind: "broker-chat",
      title: "default",
      archived: false,
      created_at: new Date().toISOString(),
    },
  });
}

async function listSessions(actor: string): Promise<SessionRow[]> {
  const sb = getServerSupabase();
  await ensureDefaultNode(actor);
  const prefix = `conv-broker-${actor}`;

  const { data: nodes } = await sb
    .schema("context_os")
    .from("nodes")
    .select("id, slug, payload, created_at")
    .like("slug", `${prefix}%`)
    .eq("node_type", "conversation");

  if (!nodes) return [];

  const filtered = nodes.filter((n) => {
    const s = n.slug as string;
    return s === prefix || s.startsWith(`${prefix}-`);
  });

  // Get latest event ts + count per node.
  const ids = filtered.map((n) => n.id as string);
  const counts = new Map<string, { last: string | null; count: number }>();
  if (ids.length) {
    const { data: events } = await sb
      .schema("context_os")
      .from("events")
      .select("subject_node_id, occurred_at")
      .in("subject_node_id", ids);
    for (const ev of events ?? []) {
      const id = ev.subject_node_id as string;
      const cur = counts.get(id) ?? { last: null, count: 0 };
      cur.count += 1;
      const ts = ev.occurred_at as string;
      if (!cur.last || ts > cur.last) cur.last = ts;
      counts.set(id, cur);
    }
  }

  const rows: SessionRow[] = filtered
    .filter((n) => {
      const p = (n.payload ?? {}) as Record<string, unknown>;
      return p.archived !== true;
    })
    .map((n) => {
      const p = (n.payload ?? {}) as Record<string, unknown>;
      const c = counts.get(n.id as string) ?? { last: null, count: 0 };
      return {
        slug: n.slug as string,
        title: (p.title as string | undefined) ?? "new chat",
        created_at: (n.created_at as string) ?? new Date().toISOString(),
        last_message_at: c.last,
        message_count: c.count,
      };
    });

  rows.sort((a, b) => {
    const ax = a.last_message_at ?? a.created_at;
    const bx = b.last_message_at ?? b.created_at;
    return bx.localeCompare(ax);
  });

  return rows;
}

export async function GET(req: NextRequest) {
  const actor = new URL(req.url).searchParams.get("actor");
  if (!actor) {
    return NextResponse.json({ error: "actor required" }, { status: 400 });
  }
  try {
    const sessions = await listSessions(actor);
    return NextResponse.json({ sessions });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

interface PostBody {
  actor?: string;
  action?: "new" | "fork" | "rename" | "archive";
  source_slug?: string;
  target_slug?: string;
  new_title?: string;
}

export async function POST(req: NextRequest) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const actor = (body.actor ?? "").trim();
  const action = body.action;
  if (!actor || !action) {
    return NextResponse.json({ error: "actor and action required" }, { status: 400 });
  }
  const sb = getServerSupabase();

  if (action === "new") {
    const slug = newSlug(actor);
    const title = body.new_title?.trim() || "new chat";
    const { error } = await sb.rpc("admin_create_broker_session", {
      p_slug: slug,
      p_content: `Broker chat session (${actor})`,
      p_payload: {
        actor,
        kind: "broker-chat",
        title,
        archived: false,
        created_at: new Date().toISOString(),
      },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ slug, title });
  }

  if (action === "fork") {
    const src = body.source_slug;
    if (!src) return NextResponse.json({ error: "source_slug required" }, { status: 400 });
    const { data: srcNode } = await sb
      .schema("context_os")
      .from("nodes")
      .select("id, payload")
      .eq("slug", src)
      .maybeSingle();
    if (!srcNode) return NextResponse.json({ error: "source not found" }, { status: 404 });
    const { data: events } = await sb
      .schema("context_os")
      .from("events")
      .select("event_kind, payload, occurred_at")
      .eq("subject_node_id", srcNode.id as string)
      .order("occurred_at", { ascending: false })
      .limit(10);
    const srcTitle = ((srcNode.payload ?? {}) as Record<string, unknown>).title as string | undefined;
    const slug = newSlug(actor);
    const title = body.new_title?.trim() || (srcTitle ? `fork: ${srcTitle}` : "fork");
    const { error } = await sb.rpc("admin_create_broker_session", {
      p_slug: slug,
      p_content: `Forked broker chat session (${actor})`,
      p_payload: {
        actor,
        kind: "broker-chat",
        title,
        archived: false,
        forked_from: src,
        created_at: new Date().toISOString(),
      },
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    // Replay last events oldest-first as new events on the fork.
    const ordered = (events ?? []).slice().reverse();
    for (const ev of ordered) {
      const role = ((ev.payload ?? {}) as Record<string, unknown>).role as string | undefined;
      const evActor = role === "assistant" ? "ds-chat-onboard" : actor;
      await sb.rpc("admin_post_event", {
        p_actor: evActor,
        p_slug: slug,
        p_kind: "message",
        p_payload: ev.payload,
        p_outcome: null,
      });
    }
    return NextResponse.json({ slug, title });
  }

  if (action === "rename") {
    const target = body.target_slug;
    const newTitle = body.new_title?.trim();
    if (!target || !newTitle) {
      return NextResponse.json({ error: "target_slug and new_title required" }, { status: 400 });
    }
    const { error } = await (sb.schema("context_os") as unknown as { rpc: typeof sb.rpc }).rpc("admin_node_set_payload", {
      p_slug: target,
      p_payload_patch: { title: newTitle },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ slug: target, title: newTitle });
  }

  if (action === "archive") {
    const target = body.target_slug;
    if (!target) return NextResponse.json({ error: "target_slug required" }, { status: 400 });
    const { error } = await (sb.schema("context_os") as unknown as { rpc: typeof sb.rpc }).rpc("admin_node_set_payload", {
      p_slug: target,
      p_payload_patch: { archived: true },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ slug: target, archived: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
