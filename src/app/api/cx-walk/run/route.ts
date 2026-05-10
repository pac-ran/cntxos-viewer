/**
 * cx-walk run route — P2 of pr-walk-slot-type convergence build.
 *
 * POST counterpart to cx-walk/[slug] GET. The GET path renders a walk_formula
 * as HTML for iframe embedding (read-only). This POST path executes the walk
 * including stake-phase mutations and returns JSON, so the viewer can fire
 * derived walks from button clicks (per pr-derive-walk-from-button).
 *
 * Body: { walk_slug, anchor_slug?, node_id?, params? }
 * Returns: { ok, result?, error? }
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import {
  executeSurface,
  RenderShape,
  SurfaceSpec,
} from "@/lib/surface-executor";

export const dynamic = "force-dynamic";

function substituteAnchor(value: unknown, anchorSlug: string): unknown {
  if (typeof value === "string") return value.replace(/\{\{anchor_slug\}\}/g, anchorSlug);
  if (Array.isArray(value)) return value.map((v) => substituteAnchor(v, anchorSlug));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, substituteAnchor(v, anchorSlug)])
    );
  }
  return value;
}

export async function POST(req: NextRequest) {
  let body: {
    walk_slug?: string;
    anchor_slug?: string;
    node_id?: string;
    params?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const walkSlug = body.walk_slug;
  if (!walkSlug) {
    return NextResponse.json({ ok: false, error: "walk_slug required" }, { status: 400 });
  }
  const anchorSlug = body.anchor_slug ?? "";
  const extraParams = (body.params ?? {}) as Record<string, unknown>;

  const sb = getServerSupabase();
  const { data: node, error } = await sb
    .schema("context_os")
    .from("nodes")
    .select("id, slug, node_type, content, payload")
    .eq("slug", walkSlug)
    .single();
  if (error || !node) {
    return NextResponse.json({ ok: false, error: `walk_formula not found: ${walkSlug}` }, { status: 404 });
  }
  const n = node as { payload: Record<string, unknown> | null };
  const payload = n.payload ?? {};
  const stepsRaw = payload.steps;
  const renderShape = String(payload.render_shape ?? "none") as RenderShape;
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
    return NextResponse.json({ ok: false, error: `walk_formula has no steps: ${walkSlug}` }, { status: 400 });
  }

  const substitutedSteps = substituteAnchor(stepsRaw, anchorSlug) as SurfaceSpec["steps"];
  const normalizedSteps = substitutedSteps.map((s, i) => ({
    id: s.id ?? `step_${i}`,
    phase: s.phase ?? ("walk" as const),
    op: s.op,
    params: s.params,
    // preserve sql query passthrough
    ...(((s as unknown) as { query?: string }).query ? { query: ((s as unknown) as { query?: string }).query } : {}),
  })) as unknown as SurfaceSpec["steps"];

  const spec: SurfaceSpec = {
    title: typeof payload.title === "string" ? payload.title : walkSlug,
    render_shape: renderShape,
    steps: normalizedSteps,
  };

  // Merge anchor + caller params for ${param:k} / {{k}} interpolation in steps.
  const mergedParams: Record<string, string> = {
    anchor_slug: anchorSlug,
    ...Object.fromEntries(Object.entries(extraParams).map(([k, v]) => [k, String(v ?? "")])),
  };

  try {
    const result = await executeSurface(spec, walkSlug, mergedParams, { allowMutations: true });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
