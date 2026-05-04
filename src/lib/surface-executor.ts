/**
 * Minimal walk executor for viewer — walk-phase ops only, no Anthropic.
 * Supports the ops used by staked surfaces: walk_scope, group_by,
 * fetch_node, fetch_events, filter, sort, limit.
 */

import { getServerSupabase } from "@/lib/supabase-server";

export type RenderShape =
  | "table" | "kanban" | "card-grid" | "dashboard"
  | "activity-stream" | "list" | "prose" | "approval-queue"
  | "scalar";

export interface SurfaceStep {
  id: string;
  phase: "walk" | "weigh" | "stake";
  op: string;
  params?: Record<string, unknown>;
}

// Column entries may be plain strings or {key, label} objects
export type ColumnEntry = string | { key: string; label?: string };

export interface ConditionalFormatRule {
  column: string;
  value: string;
  row_style?: string;
  cell_style?: string;
}

export interface SurfaceSpec {
  title?: string;
  render_shape: RenderShape;
  columns?: ColumnEntry[];
  group_by?: string;
  conditional_formatting?: ConditionalFormatRule[];
  steps: SurfaceStep[];
}

export interface SurfaceResult {
  slug: string;
  title: string;
  render_shape: RenderShape;
  columns?: ColumnEntry[];
  group_by?: string;
  conditional_formatting?: ConditionalFormatRule[];
  data: Record<string, unknown>;
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
  params: Record<string, string> = {}
): Promise<SurfaceResult> {
  const sb = getServerSupabase();
  const ctx: Record<string, unknown> = {};

  for (const step of spec.steps) {
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

      case "walk_pending_proposals": {
        // Powers s-admin-approval-queue. Returns proposal events with no
        // follow-up resolution (proposal-approved / proposal-denied / proposal-expired).
        const limit = Number(p.limit ?? 50);
        const { data, error } = await sb.rpc("list_pending_proposals", { p_limit: limit });
        if (error) throw new Error(`walk_pending_proposals: ${error.message}`);
        ctx[step.id] = (data as unknown[]) ?? [];
        break;
      }

      case "aggregate": {
        const source = String(p.source ?? "");
        const fn = String(p.fn ?? "count");
        const field = p.field ? String(p.field) : "";
        const items = Array.isArray(ctx[source]) ? (ctx[source] as Record<string, unknown>[]) : [];
        let value: number;
        if (fn === "sum" && field) {
          value = items.reduce((acc, it) => acc + (Number(resolvePath(it, field) ?? 0)), 0);
        } else if (fn === "avg" && field) {
          value = items.length > 0
            ? items.reduce((acc, it) => acc + (Number(resolvePath(it, field) ?? 0)), 0) / items.length
            : 0;
        } else {
          value = items.length; // default: count
        }
        ctx[step.id] = { value, fn, source, field };
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
    conditional_formatting: spec.conditional_formatting,
    data: ctx,
  };
}
