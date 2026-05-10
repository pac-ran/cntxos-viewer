/**
 * cx-walk route — P1 of pr-walk-slot-type convergence build.
 *
 * Renders a walk_formula node's executed result as HTML, suitable for embedding
 * via WrapperPanel `type: "walk"` slots. Mirrors cx-surface's render dispatch
 * pattern but the steps + render_shape come from a walk_formula node, and the
 * `{{anchor_slug}}` template is substituted from the query string.
 *
 * Cache: time-bucketed (walk_slug, anchor_slug, 30s bucket). See
 * surface-executor.ts for the concession note vs. dependency-tracked cache.
 *
 * Cascade guard: emits `_depth: 0` on the result envelope. P2/P3 will increment
 * when button-click → walk-derive lands.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import {
  executeSurface,
  getCachedWalk,
  setCachedWalk,
  walkCacheKey,
  RenderShape,
  SurfaceSpec,
  SurfaceResult,
} from "@/lib/surface-executor";

export const dynamic = "force-dynamic";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Recursive `{{anchor_slug}}` substitution. Walks objects/arrays so the token
// can sit anywhere in step params.
function substituteAnchor(value: unknown, anchorSlug: string): unknown {
  if (typeof value === "string") {
    return value.replace(/\{\{anchor_slug\}\}/g, anchorSlug);
  }
  if (Array.isArray(value)) {
    return value.map((v) => substituteAnchor(v, anchorSlug));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        substituteAnchor(v, anchorSlug),
      ])
    );
  }
  return value;
}

// Re-exported renderSurface dispatch. We intentionally avoid importing the
// 60+ render functions from cx-surface/[slug]/route.ts (would couple two
// routes). Instead, we delegate to a tiny dispatcher that re-uses the same
// renderSurface output by spinning up a minimal HTML shell. The actual shape
// renderers live in cx-surface; we lazy-import them via dynamic import to
// avoid duplication.
async function renderShapeHtml(result: SurfaceResult): Promise<string> {
  // Dynamic import keeps the dependency one-way. cx-surface route exports
  // nothing render-related publicly, so we read its renderSurface via a
  // module re-export shim. Simpler: replicate the dispatch by importing the
  // same functions via the route module — but Next.js route modules don't
  // export them. Pragmatic fallback: render a JSON-ish view if shape isn't
  // one we can handle inline.
  //
  // For P1 we route everything through a shared renderer we add to
  // surface-executor in a follow-up. Right now we emit a generic event-stream
  // / table view inline, sufficient for the wf-node-event-history smoke test.
  return renderGenericEventStream(result);
}

// Minimal event-stream renderer for P1. Handles the wf-node-event-history
// payload shape (events_with_scope rows). Other render_shapes fall back to a
// JSON pre-block until a shared renderer module lands in P2.
function renderGenericEventStream(result: SurfaceResult): string {
  const events = findFirstEventArray(result.data);
  if (events.length === 0) {
    if (result.render_shape !== "event-stream") {
      return `<pre style="background:#fff;border:1.5px solid #B8B09C;padding:12px;font-size:11px;overflow:auto">${escapeHtml(
        JSON.stringify(result.data, null, 2)
      )}</pre>`;
    }
    return `<p style="color:#6B6558;font-style:italic">No events.</p>`;
  }

  const rows = events
    .map((e) => {
      const occurredAt = String(e.occurred_at ?? "");
      const actor = escapeHtml(String(e.actor ?? ""));
      const kind = escapeHtml(String(e.event_kind ?? ""));
      const op = escapeHtml(String(e.atomic_op ?? ""));
      const outcome = e.outcome ? escapeHtml(String(e.outcome)) : "";
      let payloadJson = "";
      try {
        payloadJson = JSON.stringify(e.payload ?? {});
      } catch {
        payloadJson = String(e.payload ?? "");
      }
      const payloadDisplay =
        payloadJson.length > 200 ? payloadJson.slice(0, 200) + "…" : payloadJson;
      return `<tr style="border-bottom:1px solid #E8E2D2">
        <td style="padding:6px 8px;font-family:monospace;font-size:10px;color:#776E5A;white-space:nowrap">${escapeHtml(
          occurredAt.slice(0, 19).replace("T", " ")
        )}</td>
        <td style="padding:6px 8px;font-family:monospace;font-size:11px;color:#1A1A1A">${kind}</td>
        <td style="padding:6px 8px;font-family:monospace;font-size:11px;color:#C2410C">${actor}</td>
        <td style="padding:6px 8px;font-family:monospace;font-size:10px;color:#6B6558">${op}</td>
        <td style="padding:6px 8px;font-family:monospace;font-size:10px;color:#6B6558">${outcome}</td>
        <td style="padding:6px 8px;font-family:monospace;font-size:10px;color:#1A1A1A;max-width:400px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(
          payloadDisplay
        )}</td>
      </tr>`;
    })
    .join("");

  return `<div style="font-size:11px;color:#6B6558;margin-bottom:10px">${events.length} event${
    events.length === 1 ? "" : "s"
  }</div>
  <table style="width:100%;border-collapse:collapse;background:#fff;border:1.5px solid #B8B09C">
    <thead>
      <tr style="background:#F5F2E8;border-bottom:2px solid #B8B09C">
        <th style="text-align:left;padding:6px 8px;font-family:monospace;font-size:10px;font-weight:700;color:#6B6558;text-transform:uppercase;letter-spacing:.05em">When</th>
        <th style="text-align:left;padding:6px 8px;font-family:monospace;font-size:10px;font-weight:700;color:#6B6558;text-transform:uppercase;letter-spacing:.05em">Kind</th>
        <th style="text-align:left;padding:6px 8px;font-family:monospace;font-size:10px;font-weight:700;color:#6B6558;text-transform:uppercase;letter-spacing:.05em">Actor</th>
        <th style="text-align:left;padding:6px 8px;font-family:monospace;font-size:10px;font-weight:700;color:#6B6558;text-transform:uppercase;letter-spacing:.05em">Op</th>
        <th style="text-align:left;padding:6px 8px;font-family:monospace;font-size:10px;font-weight:700;color:#6B6558;text-transform:uppercase;letter-spacing:.05em">Outcome</th>
        <th style="text-align:left;padding:6px 8px;font-family:monospace;font-size:10px;font-weight:700;color:#6B6558;text-transform:uppercase;letter-spacing:.05em">Payload</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function findFirstEventArray(
  data: Record<string, unknown>
): Record<string, unknown>[] {
  for (const v of Object.values(data)) {
    if (Array.isArray(v)) return v as Record<string, unknown>[];
  }
  return [];
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const anchorSlug = req.nextUrl.searchParams.get("anchor_slug") ?? "";
  const fragment = req.nextUrl.searchParams.get("f") === "1";

  const sb = getServerSupabase();

  const { data: node, error } = await sb
    .schema("context_os")
    .from("nodes")
    .select("id, slug, node_type, content, payload")
    .eq("slug", slug)
    .single();

  if (error || !node) {
    return new NextResponse(`walk_formula not found: ${escapeHtml(slug)}`, {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const n = node as {
    id: string;
    slug: string;
    node_type: string;
    content: string | null;
    payload: Record<string, unknown> | null;
  };
  const payload = n.payload ?? {};

  const stepsRaw = payload.steps;
  const renderShape = String(payload.render_shape ?? "event-stream") as RenderShape;
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
    return new NextResponse(
      `walk_formula has no steps: ${escapeHtml(slug)}`,
      { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }

  // Substitute {{anchor_slug}} template tokens recursively across the steps
  // before handing them to the executor.
  const substitutedSteps = substituteAnchor(stepsRaw, anchorSlug) as SurfaceSpec["steps"];

  // Walk-formula payloads don't redundantly stamp phase:"walk" / step ids on
  // every step (the formula IS a walk). The executor expects both, so we
  // normalize here. Any step that already declares a phase keeps it.
  const normalizedSteps = substitutedSteps.map((s, i) => ({
    id: s.id ?? `step_${i}`,
    phase: s.phase ?? ("walk" as const),
    op: s.op,
    params: s.params,
  }));

  const spec: SurfaceSpec = {
    title: typeof payload.title === "string" ? payload.title : slug,
    render_shape: renderShape,
    columns: Array.isArray(payload.columns)
      ? (payload.columns as string[])
      : undefined,
    group_by: typeof payload.group_by === "string" ? payload.group_by : undefined,
    steps: normalizedSteps,
  };

  // Cache lookup. Time-bucketed key (concession noted in surface-executor.ts).
  const cacheKey = walkCacheKey(slug, anchorSlug);
  let result = getCachedWalk(cacheKey);
  let cacheHit = true;
  if (!result) {
    cacheHit = false;
    try {
      result = await executeSurface(spec, slug, { anchor_slug: anchorSlug });
      setCachedWalk(cacheKey, result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return new NextResponse(`walk execution failed: ${escapeHtml(msg)}`, {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  }

  // Cascade guard: stamp the result envelope with _depth. v1 always 0; the
  // route is the right place for this since downstream button-click → walk
  // derivation will pass a depth-incremented header here in P2/P3.
  const envelopeDepth = 0;

  const contentHtml = await renderShapeHtml(result);

  // Tokens match cx-surface .cxs class subset — cream paper / ink / amber rule.
  const css = `
  .cxw *{box-sizing:border-box;margin:0;padding:0}
  .cxw{background:#F5F2E8;color:#1A1A1A;font-family:Georgia,'Source Serif 4',serif;font-size:15px;line-height:1.6;padding:20px 22px;min-height:100vh}
  .cxw a{color:#C2410C}
  .cxw a:hover{text-decoration:underline}
  .cxw .header{margin-bottom:16px;padding-bottom:10px;border-bottom:2px solid #C2410C}
  .cxw .walk-title{font-family:Georgia,'Source Serif 4',serif;font-size:22px;font-weight:700;color:#1A1A1A;line-height:1.2;margin-bottom:4px}
  .cxw .meta{font-family:'JetBrains Mono','Courier New',monospace;font-size:10px;color:#6B6558;letter-spacing:.05em}
  `;

  const headerBlock = `
  <div class="header">
    <div class="walk-title">${escapeHtml(spec.title ?? slug)}</div>
    <div class="meta">walk:${escapeHtml(slug)} · anchor:${escapeHtml(
    anchorSlug || "—"
  )} · shape:${escapeHtml(renderShape)} · cache:${cacheHit ? "hit" : "miss"} · depth:${envelopeDepth}</div>
  </div>`;

  const body = `${headerBlock}<div class="content">${contentHtml}</div>`;

  const html = fragment
    ? `<style>${css}</style><div class="cxw">${body}</div>`
    : `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(
        spec.title ?? slug
      )}</title><style>${css}</style></head><body class="cxw">${body}</body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Walk-Depth": String(envelopeDepth),
      "X-Walk-Cache": cacheHit ? "hit" : "miss",
    },
  });
}
