/**
 * Minimal walk executor for viewer — walk-phase ops only, no Anthropic.
 * Supports the ops used by staked surfaces: walk_scope, group_by,
 * fetch_node, fetch_events, filter, sort, limit.
 */

import { getServerSupabase } from "@/lib/supabase-server";

export type RenderShape =
  | "table" | "kanban" | "card-grid" | "dashboard"
  | "activity-stream" | "list" | "prose" | "approval-queue" | "mermaid"
  | "file-browser" | "cluster-state" | "intercom-events" | "box-health"
  | "event-stream";

export interface SurfaceStep {
  id: string;
  phase: "walk" | "weigh" | "stake";
  op: string;
  params?: Record<string, unknown>;
}

export interface SurfaceSpec {
  title?: string;
  render_shape: RenderShape;
  columns?: string[];
  group_by?: string;
  steps: SurfaceStep[];
}

export interface SurfaceResult {
  slug: string;
  title: string;
  render_shape: RenderShape;
  columns?: string[];
  group_by?: string;
  data: Record<string, unknown>;
}

// Module-level walk-result cache (P1 of pr-walk-slot-type convergence build).
// CONCESSION: keyed by (walk_slug, anchor_slug, time-bucket) instead of the
// proper (walk_slug, anchor_slug, max(events.occurred_at) for dependent
// subjects). Time-bucketed cache invalidates every WALK_CACHE_TTL_MS regardless
// of substrate state — so a write to a dependent subject won't bust the cache,
// only the bucket roll will. Revisit in P2/P3 when reactive: true polling and
// dependency tracking land. See pr-walk-slot-type for the canonical design.
const WALK_CACHE_TTL_MS = 30_000;
const walkCache = new Map<string, { result: SurfaceResult; expiresAt: number }>();

export function getCachedWalk(key: string): SurfaceResult | null {
  const hit = walkCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    walkCache.delete(key);
    return null;
  }
  return hit.result;
}

export function setCachedWalk(key: string, result: SurfaceResult): void {
  walkCache.set(key, { result, expiresAt: Date.now() + WALK_CACHE_TTL_MS });
}

export function walkCacheKey(walkSlug: string, anchorSlug: string): string {
  // Bucket Date.now() to WALK_CACHE_TTL_MS so identical (walk, anchor) pairs
  // collapse onto the same key within a bucket.
  const bucket = Math.floor(Date.now() / WALK_CACHE_TTL_MS);
  return `${walkSlug}::${anchorSlug}::${bucket}`;
}

// Resolve dotted path: "payload.status" → item.payload.status
function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc == null) return undefined;
    if (typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

// Replace ${param:key} tokens in step params
function interpolate(value: unknown, params: Record<string, string>): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{param:([^}]+)\}/g, (_, k) => params[k] ?? "");
  }
  if (Array.isArray(value)) return value.map(v => interpolate(v, params));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, interpolate(v, params)])
    );
  }
  return value;
}

export async function executeSurface(
  spec: SurfaceSpec,
  slug: string,
  params: Record<string, string> = {},
  options: { allowMutations?: boolean } = {}
): Promise<SurfaceResult> {
  const sb = getServerSupabase();
  const ctx: Record<string, unknown> = {};

  // Interpolate template tokens in raw step strings (e.g. step.query for sql ops)
  const interpolateString = (s: string): string =>
    s.replace(/\$\{param:([^}]+)\}/g, (_, k) => params[k] ?? "")
     .replace(/\{\{([^}]+)\}\}/g, (_, k) => params[String(k).trim()] ?? "");

  for (const step of spec.steps) {
    // Mutation steps (phase=stake) only run when explicitly allowed by caller.
    // GET render path (cx-walk/[slug]) leaves allowMutations=false, so reading
    // a mutation walk via GET is read-only — no side effects.
    if (step.phase === "stake") {
      if (!options.allowMutations) continue;
      const p = interpolate(step.params ?? {}, params) as Record<string, unknown>;
      switch (step.op) {
        case "sql": {
          const rawQuery = String((step as unknown as { query?: string }).query ?? "");
          const query = interpolateString(rawQuery);
          if (!query) { ctx[step.id] = { error: "missing query" }; break; }
          // Service-role client — no RLS, but we constrain to context_os.* writes
          // and require a WHERE clause as a basic safety net.
          if (!/^\s*(UPDATE|INSERT)\s+context_os\./i.test(query)) {
            ctx[step.id] = { error: "sql op restricted to UPDATE/INSERT on context_os.*" };
            break;
          }
          if (/^\s*UPDATE/i.test(query) && !/\bWHERE\b/i.test(query)) {
            ctx[step.id] = { error: "UPDATE without WHERE rejected" };
            break;
          }
          // No generic SQL RPC exists; we parse the supported mutation shape
          // (UPDATE context_os.nodes SET <col>=<lit>[, <col>=NOW()] WHERE slug='X' AND ...)
          // and execute via the typed service-role client.
          // No /s flag (target es2017); collapse whitespace first.
          const flatQuery = query.replace(/\s+/g, " ");
          const m = /^\s*UPDATE\s+context_os\.nodes\s+SET\s+(.+?)\s+WHERE\s+slug\s*=\s*'([^']+)'(.*)$/i.exec(flatQuery);
          if (!m) {
            ctx[step.id] = { error: "sql op only supports UPDATE context_os.nodes SET ... WHERE slug='X' ..." };
            break;
          }
          const setClause = m[1];
          const targetSlug = m[2];
          const tail = m[3] ?? "";
          // Parse comma-separated SET assignments. Allow string literals, NOW(),
          // numeric, NULL. Skip updated_at=NOW() (DB trigger or we don't care).
          const updates: Record<string, unknown> = {};
          for (const part of setClause.split(/,(?![^']*'(?:[^']*'[^']*')*[^']*$)/)) {
            const a = /^\s*([a-z_][a-z0-9_]*)\s*=\s*(.+?)\s*$/i.exec(part);
            if (!a) continue;
            const col = a[1];
            const valExpr = a[2].trim();
            if (col === "updated_at") continue; // skip
            const strLit = /^'((?:[^']|'')*)'$/.exec(valExpr);
            if (strLit) updates[col] = strLit[1].replace(/''/g, "'");
            else if (/^NULL$/i.test(valExpr)) updates[col] = null;
            else if (/^-?\d+(\.\d+)?$/.test(valExpr)) updates[col] = Number(valExpr);
            else { updates[col] = valExpr; }
          }
          // Optional extra WHERE conditions: AND node_type='task' AND work_status != 'done' etc.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let q = (sb.schema("context_os") as any)
            .from("nodes")
            .update(updates)
            .eq("slug", targetSlug);
          // Parse trailing AND clauses for typical equality / inequality / IN
          const andClauses = tail.matchAll(/AND\s+([a-z_][a-z0-9_]*)\s*(=|!=|<>|IN)\s*(\([^)]*\)|'[^']*'|\d+)/gi);
          for (const c of andClauses) {
            const col = c[1];
            const opr = c[2].toUpperCase();
            const valTok = c[3];
            if (opr === "IN") {
              const inner = valTok.slice(1, -1);
              const items = [...inner.matchAll(/'([^']*)'/g)].map(x => x[1]);
              q = q.in(col, items);
            } else {
              const sLit = /^'((?:[^']|'')*)'$/.exec(valTok);
              const v = sLit ? sLit[1].replace(/''/g, "'") : (/^-?\d+(\.\d+)?$/.test(valTok) ? Number(valTok) : valTok);
              if (opr === "=") q = q.eq(col, v);
              else q = q.neq(col, v);
            }
          }
          const { data, error } = await q.select();
          if (error) { ctx[step.id] = { error: error.message }; break; }
          ctx[step.id] = { ok: true, data, updates, target_slug: targetSlug };
          break;
        }
        case "post_event": {
          const actor = String(p.actor ?? "viewer");
          const nodeSlug = String(p.node_slug ?? p.slug ?? "");
          const eventKind = String(p.event_kind ?? "walk-completed");
          const outcome = p.outcome != null ? String(p.outcome) : null;
          if (!nodeSlug) { ctx[step.id] = { error: "missing node_slug" }; break; }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data, error } = await (sb as any).rpc("admin_post_event", {
            p_actor: actor,
            p_slug: nodeSlug,
            p_kind: eventKind,
            p_payload: outcome ? { outcome } : {},
          });
          if (error) { ctx[step.id] = { error: error.message }; break; }
          ctx[step.id] = { ok: true, data };
          break;
        }
        default:
          ctx[step.id] = { error: `unknown stake op: ${step.op}` };
      }
      continue;
    }
    if (step.phase !== "walk") continue;
    const p = interpolate(step.params ?? {}, params) as Record<string, unknown>;

    switch (step.op) {
      case "walk_scope":
      case "fetch_scope":
      case "list_nodes": {
        const scope = String(p.scope ?? "root");
        const limit = Number(p.limit ?? 50);
        const orderBy = p.order_by ? String(p.order_by) : "created_at";
        const asc = p.order_asc !== false;

        // Use public schema view — scope column is text there, LIKE works.
        // context_os.nodes has scope as ltree which rejects ~~ operator.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q = (sb as any)
          .from("nodes")
          .select("id,slug,node_type,content,scope,payload,tags,status,work_status,claimed_by,updated_at,created_at")
          .like("scope", `${scope}%`)
          .order(orderBy, { ascending: asc })
          .limit(limit);

        if (p.node_type) q = q.eq("node_type", String(p.node_type));
        if (p.status)    q = q.eq("status", String(p.status));
        if (p.work_status) q = q.eq("work_status", String(p.work_status));
        if (p.claimed_by) q = q.eq("claimed_by", String(p.claimed_by));

        const { data } = await q;
        ctx[step.id] = data ?? [];
        break;
      }

      case "fetch_node": {
        const nodeSlug = String(p.slug ?? "");
        if (!nodeSlug) { ctx[step.id] = null; break; }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (sb as any)
          .from("nodes")
          .select("id,slug,node_type,content,scope,payload,tags,status,work_status,claimed_by")
          .eq("slug", nodeSlug)
          .single();
        ctx[step.id] = data ?? null;
        break;
      }

      case "fetch_events": {
        const nodeSlug = String(p.node_slug ?? p.slug ?? "");
        const limit = Number(p.limit ?? 20);
        // event_kinds accepts array OR singular event_kind param
        const eventKinds: string[] | undefined = Array.isArray(p.event_kinds)
          ? (p.event_kinds as string[])
          : (typeof p.event_kinds === "string" && p.event_kinds.length > 0)
            ? [(p.event_kinds as string)]
            : (p.event_kind ? [String(p.event_kind)] : undefined);
        const scopePrefix = p.scope_prefix ? String(p.scope_prefix) : "";

        if (scopePrefix) {
          // public schema: public.nodes.scope is text — LIKE works
          // do NOT use sb.schema("context_os") here — ltree rejects ~~
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let q = (sb as any)
            .from("events")
            .select("event_kind,actor,outcome,payload,occurred_at,subject_node_id,nodes!inner(scope)")
            .like("nodes.scope", `${scopePrefix}%`)
            .order("occurred_at", { ascending: false })
            .limit(limit);
          if (eventKinds?.length) q = q.in("event_kind", eventKinds);
          if (p.actor) q = q.eq("actor", String(p.actor));
          const { data } = await q;
          ctx[step.id] = (data ?? []).map((e: Record<string, unknown>) => {
            const { nodes: _n, ...rest } = e as Record<string, unknown> & { nodes: unknown };
            return rest;
          });
          break;
        }

        if (nodeSlug) {
          // Mode: node-specific — fetch events for a specific node slug
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: n } = await (sb as any)
            .from("nodes").select("id").eq("slug", nodeSlug).single();
          if (!n?.id) { ctx[step.id] = []; break; }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let q = (sb.schema("context_os") as any)
            .from("events")
            .select("event_kind,actor,outcome,payload,occurred_at,subject_node_id")
            .eq("subject_node_id", n.id)
            .order("occurred_at", { ascending: false })
            .limit(limit);
          if (eventKinds?.length) q = q.in("event_kind", eventKinds);
          const { data } = await q;
          ctx[step.id] = data ?? [];
        } else {
          // Mode: global feed — no slug, filter by event_kind/event_kinds
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let q = (sb.schema("context_os") as any)
            .from("events")
            .select("event_kind,actor,outcome,payload,occurred_at,subject_node_id")
            .order("occurred_at", { ascending: false })
            .limit(limit);
          if (eventKinds?.length) q = q.in("event_kind", eventKinds);
          const { data } = await q;
          ctx[step.id] = data ?? [];
        }
        break;
      }

      case "fetch_events_with_scope": {
        // Queries context_os.events_with_scope (joined view) for full
        // event-stream render: includes atomic_op, phase, scope, node_slug, etc.
        const nodeSlug = String(p.node_slug ?? p.slug ?? "");
        const nodeId = String(p.node_id ?? "");
        const limit = Number(p.limit ?? 100);
        const order = String(p.order ?? "desc").toLowerCase() === "asc" ? true : false;

        let resolvedNodeId = nodeId;
        if (!resolvedNodeId && nodeSlug) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: n } = await (sb as any)
            .from("nodes").select("id").eq("slug", nodeSlug).single();
          if (!n?.id) { ctx[step.id] = []; break; }
          resolvedNodeId = String(n.id);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q = (sb.schema("context_os") as any)
          .from("events_with_scope")
          .select("id,occurred_at,event_kind,actor,atomic_op,phase,outcome,payload,parent_event_id,session_id,subject_node_id,node_slug,node_type,scope,node_tags")
          .order("occurred_at", { ascending: order })
          .limit(limit);
        if (resolvedNodeId) q = q.eq("subject_node_id", resolvedNodeId);
        if (p.event_kind) q = q.eq("event_kind", String(p.event_kind));
        if (p.actor) q = q.eq("actor", String(p.actor));
        if (p.atomic_op) q = q.eq("atomic_op", String(p.atomic_op));
        const { data, error } = await q;
        if (error) throw new Error(`fetch_events_with_scope: ${error.message}`);
        ctx[step.id] = data ?? [];
        break;
      }

      case "group_by": {
        const src = (ctx[String(p.source ?? "")] ?? Object.values(ctx).find(v => Array.isArray(v)) ?? []) as Record<string, unknown>[];
        const field = String(p.by ?? p.field ?? p.key ?? "");
        if (!Array.isArray(src) || !field) { ctx[step.id] = {}; break; }
        const groups: Record<string, unknown[]> = {};
        for (const item of src) {
          const pl = (item.payload ?? {}) as Record<string, unknown>;
          const key = String(resolvePath(item, field) ?? resolvePath(pl, field) ?? "other");
          if (!groups[key]) groups[key] = [];
          groups[key].push(item);
        }
        ctx[step.id] = groups;
        break;
      }

      case "sort": {
        const src = [...((ctx[String(p.source ?? "")] ?? []) as unknown[])];
        const field = String(p.by ?? p.field ?? "");
        const asc = p.direction !== "desc";
        if (field) src.sort((a, b) => {
          const av = resolvePath(a as Record<string, unknown>, field);
          const bv = resolvePath(b as Record<string, unknown>, field);
          const cmp = String(av ?? "").localeCompare(String(bv ?? ""));
          return asc ? cmp : -cmp;
        });
        ctx[step.id] = src;
        break;
      }

      case "limit": {
        const src = ctx[String(p.source ?? "")] ?? [];
        const n = Number(p.n ?? p.limit ?? 10);
        ctx[step.id] = Array.isArray(src) ? src.slice(0, n) : src;
        break;
      }

      case "filter": {
        ctx[step.id] = ctx[String(p.source ?? "")] ?? [];
        break;
      }

      case "read_fs": {
        const { readdir, readFile, stat } = await import("fs/promises");
        const ALLOWLIST = ["/home/ubuntu/code/cntxos/scripts", "/home/ubuntu/code/cntxos/docs", "/home/ubuntu/code/viewer"];
        const dirPath = String(p.path ?? "");
        if (!ALLOWLIST.some(a => dirPath.startsWith(a))) {
          ctx[step.id] = { error: "path not in allowlist" };
          break;
        }
        const entries = await readdir(dirPath);
        const files = await Promise.all(
          entries
            .filter(f => !f.startsWith("."))
            .map(async (name) => {
              const full = `${dirPath}/${name}`;
              const st = await stat(full);
              let description = "";
              if (st.isFile()) {
                try {
                  const buf = await readFile(full, "utf8");
                  const lines = buf.split("\n").filter(l => l.trim() && !/^#!/.test(l));
                  const comment = lines.find(l => /^[#/]/.test(l));
                  description = (comment ?? lines[0] ?? "").replace(/^[#/ *-]+/, "").trim().slice(0, 120);
                } catch { description = ""; }
              }
              return { name, size: st.size, mtime: st.mtime.toISOString().slice(0, 10), is_dir: st.isDirectory(), description };
            })
        );
        ctx[step.id] = files.sort((a, b) => Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name));
        break;
      }

      case "read_cluster_state": {
        const { readFile: rcsReadFile } = await import("fs/promises");
        const { execSync } = await import("child_process");
        const logLines = Number(p.log_lines ?? 10);

        let sessions: string[] = [];
        try {
          const out = execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null || true', { encoding: "utf8" }).trim();
          sessions = out.split("\n").filter(Boolean);
        } catch { sessions = []; }

        let last_cmd: Record<string, unknown> = {};
        try {
          const raw = await rcsReadFile("/home/ubuntu/code/cntxos/.handoff/cluster-control-cmd.json", "utf8");
          last_cmd = JSON.parse(raw.trim());
        } catch { last_cmd = {}; }

        let spawn_log: string[] = [];
        try {
          const logContent = await rcsReadFile("/home/ubuntu/code/cntxos/.handoff/.cc-patrol-cron.log", "utf8");
          spawn_log = logContent.split("\n").filter(Boolean).slice(-logLines);
        } catch { spawn_log = []; }

        ctx[step.id] = { sessions, last_cmd, spawn_log };
        break;
      }

      case "walk_pending_proposals": {
        // Powers s-admin-approval-queue. Returns proposal events with no
        // follow-up resolution (proposal-approved / proposal-denied / proposal-expired).
        const limit = Number(p.limit ?? 50);
        const { data, error } = await sb.rpc("list_pending_proposals", { p_limit: limit });
        if (error) throw new Error(`walk_pending_proposals: ${error.message}`);
        ctx[step.id] = (data as unknown[]) ?? [];
        break;
      }

      case "read_intercom_state": {
        const { readFile: riReadFile, stat: riStat } = await import("fs/promises");
        const logLines = Number(p.log_lines ?? 20);
        const LOG_PATH = "/home/ubuntu/code/cntxos/.handoff/intercom-bridge.log";
        const STATE_PATH = "/home/ubuntu/code/cntxos/.handoff/.intercom-bridge.state";

        let stateAgeSeconds = -1;
        try {
          const st = await riStat(STATE_PATH);
          stateAgeSeconds = Math.floor((Date.now() - st.mtimeMs) / 1000);
        } catch { /* no state file */ }

        const entries: Record<string, unknown>[] = [];
        try {
          const raw = await riReadFile(LOG_PATH, "utf8");
          for (const line of raw.split("\n").filter(Boolean)) {
            try { entries.push(JSON.parse(line)); } catch { /* skip bad lines */ }
          }
        } catch { /* no log yet */ }

        const forwarded = entries.filter(e => e.status === "forwarded");
        const recentForwarded = forwarded.slice(-logLines);
        const recentErrors = entries.filter(e => e.status === "rest_error").slice(-5);
        const lastForwardedAt = forwarded.length > 0
          ? String((forwarded[forwarded.length - 1] as Record<string, unknown>).ts ?? "")
          : "";

        ctx[step.id] = {
          state_age_seconds: stateAgeSeconds,
          last_forwarded_at: lastForwardedAt,
          forwarded_count: forwarded.length,
          recent_forwarded: recentForwarded,
          recent_errors: recentErrors,
        };
        break;
      }

      case "read_box_health": {
        const { execSync: bhExecSync } = await import("child_process");
        const run = (cmd: string): string => {
          try { return bhExecSync(cmd, { encoding: "utf8", timeout: 5000 }).trim(); }
          catch (e) { return `error: ${e instanceof Error ? e.message : String(e)}`; }
        };
        const uptime = run("uptime -p");
        const disk = run("df -h /");
        const memory = run("free -h");
        const errors = run("journalctl --since='1 hour ago' --priority=err -n 10 --no-pager 2>/dev/null || true");
        ctx[step.id] = {
          uptime,
          disk,
          memory,
          recent_errors: errors ? errors.split("\n").filter(Boolean) : [],
        };
        break;
      }

      default:
        ctx[step.id] = {};
    }
  }

  return {
    slug,
    title: spec.title ?? slug,
    render_shape: spec.render_shape as RenderShape,
    columns: spec.columns,
    group_by: spec.group_by,
    data: ctx,
  };
}
