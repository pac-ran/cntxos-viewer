// DS tool definitions + executors. Centralized here so the chat route stays
// small and the boot prompt stays free of tool descriptions (DeepSeek's
// `tools` parameter carries the schema; the model picks tools on its own).
//
// Each tool has:
//   - DEFINITION: OpenAI-format function schema (sent to DeepSeek).
//   - executor:    async (args, ctx) => result. Result is JSON-serialized
//                  and returned to the model as the tool message.
//
// Auditing: every executor invocation is logged as a substrate event on the
// per-actor session log node `s-ds-tool-log-{actor}` via admin_post_event.
// Lazy-creates the log node on first use.

import { getServerSupabase } from "@/lib/supabase-server";

// ─── Types ────────────────────────────────────────────────────────────────

export interface ToolContext {
  actor: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

type Executor = (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;

interface Tool {
  def: ToolDefinition;
  exec: Executor;
  atomic_op: "read" | "write" | "route" | "decompose";
}

const TOOL_LOG_ACTOR = "ds-chat-onboard";

// ─── Helpers ──────────────────────────────────────────────────────────────

async function getNodeIdBySlug(slug: string): Promise<string | null> {
  const sb = getServerSupabase();
  const { data } = await sb
    .schema("context_os")
    .from("nodes")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function ensureNode(
  slug: string,
  nodeType: string,
  content: string,
  payload: Record<string, unknown>
): Promise<void> {
  const existing = await getNodeIdBySlug(slug);
  if (existing) return;
  const sb = getServerSupabase();
  // admin_node_upsert handles the insert path safely.
  await sb.rpc("admin_node_upsert", {
    p_slug: slug,
    p_patch: { node_type: nodeType, content, payload },
    p_create_if_missing: true,
  });
}

async function postEvent(
  actor: string,
  slug: string,
  kind: string,
  payload: Record<string, unknown>,
  outcome?: string
): Promise<{ event_id?: string; error?: string }> {
  const sb = getServerSupabase();
  const { data, error } = await sb.rpc("admin_post_event", {
    p_actor: actor,
    p_slug: slug,
    p_kind: kind,
    p_payload: payload,
    p_outcome: outcome ?? null,
  });
  if (error) return { error: error.message };
  const d = data as { ok?: boolean; event_id?: string } | null;
  return { event_id: d?.event_id };
}

function summarize(result: unknown): string {
  let s: string;
  try {
    s = typeof result === "string" ? result : JSON.stringify(result);
  } catch {
    s = String(result);
  }
  return s.length > 500 ? s.slice(0, 500) + "…" : s;
}

async function logToolCall(
  actor: string,
  toolName: string,
  atomicOp: string,
  args: unknown,
  result: unknown,
  latencyMs: number,
  error?: string
): Promise<void> {
  const logSlug = `s-ds-tool-log-${actor}`;
  await ensureNode(logSlug, "session", `DS tool-call audit log for ${actor}`, {
    actor,
    kind: "ds-tool-log",
  });
  // Reuse postEvent but with a custom atomic_op via direct insert isn't
  // possible without exposing it. admin_post_event doesn't accept atomic_op,
  // so we embed it in the payload — readers can index it.
  // event_kind 'observation' is the closest substrate-allowed kind for an
  // audit/telemetry record. The fact that this is a tool-call is tagged via
  // payload.kind so dashboards can filter precisely.
  await postEvent(
    TOOL_LOG_ACTOR,
    logSlug,
    "observation",
    {
      kind: "tool-call",
      tool_name: toolName,
      atomic_op: atomicOp,
      args,
      result_summary: summarize(result),
      latency_ms: latencyMs,
      ...(error ? { error } : {}),
    },
    error ? "error" : "success"
  );
}

// ─── Tool: read_node ──────────────────────────────────────────────────────

const READ_NODE: Tool = {
  atomic_op: "read",
  def: {
    type: "function",
    function: {
      name: "read_node",
      description: "Read a substrate node by slug. Returns the node fields plus the 10 most recent events on it.",
      parameters: {
        type: "object",
        properties: {
          slug: { type: "string", description: "Stable slug identifier of the node." },
        },
        required: ["slug"],
      },
    },
  },
  exec: async (args) => {
    const slug = String(args.slug ?? "");
    if (!slug) return { not_found: true, error: "slug required" };
    const sb = getServerSupabase();
    const { data: node } = await sb
      .schema("context_os")
      .from("nodes")
      .select("id, slug, node_type, scope, status, visibility, tags, content, payload")
      .eq("slug", slug)
      .maybeSingle();
    if (!node) return { slug, not_found: true };
    const { data: events } = await sb
      .schema("context_os")
      .from("events")
      .select("occurred_at, event_kind, actor, outcome, payload, atomic_op")
      .eq("subject_node_id", node.id as string)
      .order("occurred_at", { ascending: false })
      .limit(10);
    return {
      slug: node.slug,
      node_type: node.node_type,
      scope: node.scope,
      status: node.status,
      visibility: node.visibility,
      tags: node.tags,
      content: node.content,
      payload: node.payload,
      recent_events: events ?? [],
    };
  },
};

// ─── Tool: search_nodes ───────────────────────────────────────────────────

const SEARCH_NODES: Tool = {
  atomic_op: "read",
  def: {
    type: "function",
    function: {
      name: "search_nodes",
      description: "Search substrate nodes by ILIKE on slug + content. Optional filters by node_type and scope prefix.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          node_types: { type: "array", items: { type: "string" } },
          scopes: { type: "array", items: { type: "string" }, description: "Scope prefixes (ltree)." },
          include_archived: { type: "boolean", default: false },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        },
        required: ["query"],
      },
    },
  },
  exec: async (args) => {
    const query = String(args.query ?? "");
    const limit = Math.min(Math.max(Number(args.limit ?? 20), 1), 100);
    const includeArchived = !!args.include_archived;
    const nodeTypes = Array.isArray(args.node_types) ? (args.node_types as string[]) : [];
    const scopes = Array.isArray(args.scopes) ? (args.scopes as string[]) : [];

    const sb = getServerSupabase();
    // Use ds_query_as_reader so we get a single SQL query that can OR across
    // slug, content, AND tags array (PostgREST .or() on array columns is hard).
    const safe = query.replace(/'/g, "''");
    const archivedClause = includeArchived ? "" : " AND status <> 'archived'";
    const typesClause =
      nodeTypes.length > 0
        ? ` AND node_type IN (${nodeTypes.map((t) => `'${t.replace(/'/g, "''")}'`).join(",")})`
        : "";
    const sql = `
      SELECT slug, node_type, scope::text AS scope, content
        FROM context_os.nodes
       WHERE (slug ILIKE '%${safe}%' OR content ILIKE '%${safe}%' OR '${safe}' = ANY(tags))
       ${archivedClause}
       ${typesClause}
       ORDER BY updated_at DESC
       LIMIT ${limit}
    `;
    const { data, error } = await sb.rpc("ds_query_as_reader", { p_sql: sql });
    if (error) return { results: [], count: 0, error: error.message };
    let rows = (Array.isArray(data) ? data : []) as Array<{
      slug: string;
      node_type: string;
      scope: string;
      content: string;
    }>;
    if (scopes.length > 0) {
      rows = rows.filter((r) => scopes.some((s) => String(r.scope).startsWith(s)));
    }
    return {
      results: rows.map((r) => ({
        slug: r.slug,
        node_type: r.node_type,
        scope: r.scope,
        snippet: (r.content ?? "").slice(0, 200),
      })),
      count: rows.length,
    };
  },
};

// ─── Tool: list_events ────────────────────────────────────────────────────

const LIST_EVENTS: Tool = {
  atomic_op: "read",
  def: {
    type: "function",
    function: {
      name: "list_events",
      description: "List events for a node (newest first). Supports a 'since' ISO timestamp.",
      parameters: {
        type: "object",
        properties: {
          slug: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 500, default: 50 },
          since: { type: "string", description: "ISO timestamp." },
        },
        required: ["slug"],
      },
    },
  },
  exec: async (args) => {
    const slug = String(args.slug ?? "");
    const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 500);
    const since = typeof args.since === "string" ? args.since : null;
    const id = await getNodeIdBySlug(slug);
    if (!id) return { events: [], not_found: true };
    const sb = getServerSupabase();
    let q = sb
      .schema("context_os")
      .from("events")
      .select("id, occurred_at, event_kind, actor, outcome, payload, atomic_op")
      .eq("subject_node_id", id)
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (since) q = q.gte("occurred_at", since);
    const { data, error } = await q;
    if (error) return { events: [], error: error.message };
    return { events: data ?? [] };
  },
};

// ─── Tool: query_substrate ────────────────────────────────────────────────

const QUERY_SUBSTRATE: Tool = {
  atomic_op: "read",
  def: {
    type: "function",
    function: {
      name: "query_substrate",
      description: "Run a read-only SQL query against context_os.* (executed as ds_reader role; SELECT only). 1000-row hard cap.",
      parameters: {
        type: "object",
        properties: { sql: { type: "string" } },
        required: ["sql"],
      },
    },
  },
  exec: async (args) => {
    const sql = String(args.sql ?? "").trim();
    if (!sql) return { rows: [], row_count: 0, error: "sql required" };
    const sb = getServerSupabase();
    const { data, error } = await sb.rpc("ds_query_as_reader", { p_sql: sql });
    if (error) return { rows: [], row_count: 0, error: error.message };
    const rows = Array.isArray(data) ? (data as unknown[]) : [];
    const capped = rows.slice(0, 1000);
    return { rows: capped, row_count: capped.length, truncated: rows.length > 1000 };
  },
};

// ─── Tool: list_sessions ──────────────────────────────────────────────────

const LIST_SESSIONS: Tool = {
  atomic_op: "read",
  def: {
    type: "function",
    function: {
      name: "list_sessions",
      description: "List broker chat sessions for an actor (defaults to current).",
      parameters: {
        type: "object",
        properties: { actor: { type: "string" } },
      },
    },
  },
  exec: async (args, ctx) => {
    const actor = String(args.actor ?? ctx.actor);
    const sb = getServerSupabase();
    const prefix = `conv-broker-${actor}`;
    const { data: nodes } = await sb
      .schema("context_os")
      .from("nodes")
      .select("id, slug, payload")
      .like("slug", `${prefix}%`)
      .eq("node_type", "conversation");
    const filtered = (nodes ?? []).filter((n) => {
      const s = n.slug as string;
      return s === prefix || s.startsWith(`${prefix}-`);
    });
    const sessions = await Promise.all(
      filtered.map(async (n) => {
        const { count } = await sb
          .schema("context_os")
          .from("events")
          .select("id", { head: true, count: "exact" })
          .eq("subject_node_id", n.id as string)
          .eq("event_kind", "message");
        const { data: last } = await sb
          .schema("context_os")
          .from("events")
          .select("occurred_at")
          .eq("subject_node_id", n.id as string)
          .order("occurred_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const payload = (n.payload ?? {}) as Record<string, unknown>;
        return {
          slug: n.slug as string,
          title: (payload.title as string) ?? "untitled",
          archived: !!payload.archived,
          message_count: count ?? 0,
          last_message_at: (last?.occurred_at as string | undefined) ?? null,
        };
      })
    );
    return { sessions };
  },
};

// ─── Tool: write_node ─────────────────────────────────────────────────────

const WRITE_NODE: Tool = {
  atomic_op: "write",
  def: {
    type: "function",
    function: {
      name: "write_node",
      description: "Create or patch a substrate node. Patch fields: node_type, scope, content, payload, tags, status, visibility. Payload is shallow-merged; tags is replaced.",
      parameters: {
        type: "object",
        properties: {
          slug: { type: "string" },
          patch: {
            type: "object",
            properties: {
              node_type: { type: "string" },
              scope: { type: "string" },
              content: { type: "string" },
              payload: { type: "object" },
              tags: { type: "array", items: { type: "string" } },
              status: { type: "string" },
              visibility: { type: "string" },
            },
          },
          create_if_missing: { type: "boolean", default: false },
        },
        required: ["slug", "patch"],
      },
    },
  },
  exec: async (args) => {
    const slug = String(args.slug ?? "");
    const patch = (args.patch ?? {}) as Record<string, unknown>;
    const createIfMissing = !!args.create_if_missing;
    const sb = getServerSupabase();
    const { data, error } = await sb.rpc("admin_node_upsert", {
      p_slug: slug,
      p_patch: patch,
      p_create_if_missing: createIfMissing,
    });
    if (error) return { error: error.message };
    return data;
  },
};

// ─── Tool: post_event ─────────────────────────────────────────────────────

const POST_EVENT: Tool = {
  atomic_op: "write",
  def: {
    type: "function",
    function: {
      name: "post_event",
      description: "Append an event to a node. Use for state transitions, observations, or signals.",
      parameters: {
        type: "object",
        properties: {
          slug: { type: "string" },
          event_kind: { type: "string" },
          payload: { type: "object" },
          atomic_op: { type: "string", enum: ["read", "write", "render", "evaluate", "route", "decompose"] },
          outcome: { type: "string" },
        },
        required: ["slug", "event_kind", "payload"],
      },
    },
  },
  exec: async (args) => {
    const slug = String(args.slug ?? "");
    const kind = String(args.event_kind ?? "");
    const payload = (args.payload ?? {}) as Record<string, unknown>;
    if (args.atomic_op) (payload as Record<string, unknown>).atomic_op = args.atomic_op;
    const outcome = typeof args.outcome === "string" ? args.outcome : undefined;
    const r = await postEvent(TOOL_LOG_ACTOR, slug, kind, payload, outcome);
    if (r.error) return { error: r.error };
    return { event_id: r.event_id, occurred_at: new Date().toISOString() };
  },
};

// ─── Tool: archive_node ───────────────────────────────────────────────────

const ARCHIVE_NODE: Tool = {
  atomic_op: "write",
  def: {
    type: "function",
    function: {
      name: "archive_node",
      description: "Set status='archived' on a node (soft delete).",
      parameters: {
        type: "object",
        properties: { slug: { type: "string" } },
        required: ["slug"],
      },
    },
  },
  exec: async (args) => {
    const slug = String(args.slug ?? "");
    const sb = getServerSupabase();
    const { data, error } = await sb.rpc("admin_node_upsert", {
      p_slug: slug,
      p_patch: { status: "archived" },
      p_create_if_missing: false,
    });
    if (error) return { error: error.message };
    return { slug, status: "archived", result: data };
  },
};

// ─── Tool: delete_node ────────────────────────────────────────────────────

const DELETE_NODE: Tool = {
  atomic_op: "write",
  def: {
    type: "function",
    function: {
      name: "delete_node",
      description: "Hard-delete a node and its events. Requires confirm:true. Irreversible.",
      parameters: {
        type: "object",
        properties: {
          slug: { type: "string" },
          confirm: { type: "boolean", description: "Must be true." },
        },
        required: ["slug", "confirm"],
      },
    },
  },
  exec: async (args) => {
    if (args.confirm !== true) return { error: "confirm must be true to delete" };
    const slug = String(args.slug ?? "");
    const sb = getServerSupabase();
    const { data, error } = await sb.rpc("admin_node_hard_delete", { p_slug: slug });
    if (error) return { error: error.message };
    return data;
  },
};

// ─── Tool: run_walk ───────────────────────────────────────────────────────

const RUN_WALK: Tool = {
  atomic_op: "write",
  def: {
    type: "function",
    function: {
      name: "run_walk",
      description: "Run a SQL statement (read or write) as ds_writer role against context_os.*. Use for INSERT/UPDATE/DELETE that doesn't fit write_node, or for joins/CTEs. No DDL.",
      parameters: {
        type: "object",
        properties: {
          sql_or_walk_name: { type: "string" },
          args: { type: "object" },
        },
        required: ["sql_or_walk_name"],
      },
    },
  },
  exec: async (args) => {
    const sql = String(args.sql_or_walk_name ?? "").trim();
    if (!sql) return { rows: [], error: "sql required" };
    const sb = getServerSupabase();
    const { data, error } = await sb.rpc("ds_query_as_writer", { p_sql: sql });
    if (error) return { rows: [], error: error.message };
    const rows = Array.isArray(data) ? (data as unknown[]) : [];
    return { rows: rows.slice(0, 1000), row_count: rows.length };
  },
};

// ─── Tool: set_left_pane ──────────────────────────────────────────────────

const SET_LEFT_PANE: Tool = {
  atomic_op: "route",
  def: {
    type: "function",
    function: {
      name: "set_left_pane",
      description: "Navigate the user's LEFT workspace pane to a substrate node by slug.",
      parameters: {
        type: "object",
        properties: { slug: { type: "string" } },
        required: ["slug"],
      },
    },
  },
  exec: async (args, ctx) => {
    const slug = String(args.slug ?? "");
    const stateSlug = `conv-left-state-${ctx.actor}`;
    await ensureNode(stateSlug, "conversation", `Left-pane state for ${ctx.actor}`, {
      actor: ctx.actor,
      kind: "left-pane-state",
    });
    const r = await postEvent(TOOL_LOG_ACTOR, stateSlug, "frame-update", {
      slot: "main",
      target_slug: slug,
    });
    if (r.error) return { posted: false, error: r.error };
    return { slug, posted: true };
  },
};

// ─── Tool: set_frame_slots ────────────────────────────────────────────────

const SET_FRAME_SLOTS: Tool = {
  atomic_op: "route",
  def: {
    type: "function",
    function: {
      name: "set_frame_slots",
      description: "Set the slots for the user's UPPER-RIGHT (wrapper) pane. Posts a frame-update event with slot definitions.",
      parameters: {
        type: "object",
        properties: {
          slots: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                type: { type: "string", enum: ["surface", "node", "stream"] },
                ref: { type: "string" },
              },
              required: ["name", "type", "ref"],
            },
          },
        },
        required: ["slots"],
      },
    },
  },
  exec: async (args, ctx) => {
    const slots = Array.isArray(args.slots) ? args.slots : [];
    const stateSlug = `conv-frame-state-${ctx.actor}`;
    await ensureNode(stateSlug, "conversation", `Frame state for ${ctx.actor}`, {
      actor: ctx.actor,
      kind: "frame-state",
    });
    const r = await postEvent(TOOL_LOG_ACTOR, stateSlug, "frame-update", { slots });
    if (r.error) return { posted: false, error: r.error };
    return { posted: true, slot_count: slots.length };
  },
};

// ─── Tool: get_workspace_state ────────────────────────────────────────────

const GET_WORKSPACE_STATE: Tool = {
  atomic_op: "read",
  def: {
    type: "function",
    function: {
      name: "get_workspace_state",
      description: "Snapshot the user's workspace: current LEFT pane slug, frame slots, active chat session, recent tool actions.",
      parameters: { type: "object", properties: {} },
    },
  },
  exec: async (_args, ctx) => {
    const sb = getServerSupabase();
    const leftSlug = `conv-left-state-${ctx.actor}`;
    const frameSlug = `conv-frame-state-${ctx.actor}`;
    const logSlug = `s-ds-tool-log-${ctx.actor}`;

    const lookup = async (slug: string, kind: string) => {
      const id = await getNodeIdBySlug(slug);
      if (!id) return null;
      const { data } = await sb
        .schema("context_os")
        .from("events")
        .select("payload, occurred_at")
        .eq("subject_node_id", id)
        .eq("event_kind", kind)
        .order("occurred_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data?.payload as Record<string, unknown> | undefined) ?? null;
    };

    const leftLatest = await lookup(leftSlug, "frame-update");
    const frameLatest = await lookup(frameSlug, "frame-update");

    // Most recently active broker session for this actor.
    const prefix = `conv-broker-${ctx.actor}`;
    const { data: sessNodes } = await sb
      .schema("context_os")
      .from("nodes")
      .select("id, slug, payload")
      .like("slug", `${prefix}%`)
      .eq("node_type", "conversation");
    let activeChat: string | null = null;
    let bestTs = "";
    for (const n of sessNodes ?? []) {
      if (n.slug !== prefix && !(n.slug as string).startsWith(`${prefix}-`)) continue;
      const { data: last } = await sb
        .schema("context_os")
        .from("events")
        .select("occurred_at")
        .eq("subject_node_id", n.id as string)
        .order("occurred_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const ts = (last?.occurred_at as string | undefined) ?? "";
      if (ts > bestTs) {
        bestTs = ts;
        activeChat = n.slug as string;
      }
    }

    // Recent actions from the tool log.
    let recentActions: unknown[] = [];
    const logId = await getNodeIdBySlug(logSlug);
    if (logId) {
      const { data: events } = await sb
        .schema("context_os")
        .from("events")
        .select("occurred_at, payload, outcome")
        .eq("subject_node_id", logId)
        .eq("event_kind", "tool-call")
        .order("occurred_at", { ascending: false })
        .limit(5);
      recentActions = events ?? [];
    }

    return {
      left_pane_slug: (leftLatest?.target_slug as string | undefined) ?? null,
      frame_slots: (frameLatest?.slots as unknown[] | undefined) ?? [],
      active_chat_session: activeChat,
      recent_actions: recentActions,
    };
  },
};

// ─── Registry ─────────────────────────────────────────────────────────────

const TOOLS: Record<string, Tool> = {
  read_node: READ_NODE,
  search_nodes: SEARCH_NODES,
  list_events: LIST_EVENTS,
  query_substrate: QUERY_SUBSTRATE,
  list_sessions: LIST_SESSIONS,
  write_node: WRITE_NODE,
  post_event: POST_EVENT,
  archive_node: ARCHIVE_NODE,
  delete_node: DELETE_NODE,
  run_walk: RUN_WALK,
  // set_left_pane intentionally omitted — LEFT pane is user/org CRUD only.
  // Agent does NOT drive LEFT (Randy 2026-05-09). Tool body remains in file
  // for now in case we ever expose to a different surface, but not in TOOLS map.
  set_frame_slots: SET_FRAME_SLOTS,
  get_workspace_state: GET_WORKSPACE_STATE,
};

export const DS_TOOL_DEFINITIONS: ToolDefinition[] = Object.values(TOOLS).map((t) => t.def);

export interface ExecutedTool {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  error?: string;
  latency_ms: number;
}

export async function executeTool(
  name: string,
  rawArgs: string,
  ctx: ToolContext
): Promise<ExecutedTool> {
  const start = Date.now();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
  } catch (err) {
    const latency = Date.now() - start;
    const error = `invalid JSON args: ${(err as Error).message}`;
    await logToolCall(ctx.actor, name, "read", { raw: rawArgs }, null, latency, error).catch(() => {});
    return { name, args: { _raw: rawArgs }, result: { error }, error, latency_ms: latency };
  }
  const tool = TOOLS[name];
  if (!tool) {
    const latency = Date.now() - start;
    const error = `unknown tool: ${name}`;
    await logToolCall(ctx.actor, name, "read", parsed, null, latency, error).catch(() => {});
    return { name, args: parsed, result: { error }, error, latency_ms: latency };
  }
  try {
    const result = await tool.exec(parsed, ctx);
    const latency = Date.now() - start;
    const errMsg =
      result && typeof result === "object" && (result as Record<string, unknown>).error
        ? String((result as Record<string, unknown>).error)
        : undefined;
    await logToolCall(ctx.actor, name, tool.atomic_op, parsed, result, latency, errMsg).catch(() => {});
    return { name, args: parsed, result, error: errMsg, latency_ms: latency };
  } catch (err) {
    const latency = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    await logToolCall(ctx.actor, name, tool.atomic_op, parsed, null, latency, error).catch(() => {});
    return { name, args: parsed, result: { error }, error, latency_ms: latency };
  }
}
