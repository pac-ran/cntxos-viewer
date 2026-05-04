import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { marked } from "marked";
import { executeSurface, SurfaceSpec, SurfaceResult } from "@/lib/surface-executor";

export const dynamic = "force-dynamic";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function resolveField(item: Record<string, unknown>, field: string): unknown {
  const parts = field.split(".");
  let cur: unknown = item;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

const STATUS_COLORS: Record<string, string> = {
  inbox: "#6b7280",
  ready: "#3b82f6",
  "in-progress": "#f59e0b",
  blocked: "#ef4444",
  review: "#8b5cf6",
  done: "#22c55e",
  archived: "#4b5563",
  dissolved: "#374151",
};

function statusBadge(val: string): string {
  const color = STATUS_COLORS[val] ?? "#6b7280";
  return `<span style="font-size:10px;padding:1px 6px;border-radius:3px;background:${color}22;color:${color};border:1px solid ${color}55;font-family:monospace">${escapeHtml(val)}</span>`;
}

function renderCard(item: Record<string, unknown>, columns?: string[]): string {
  const slug = escapeHtml(String(item.slug ?? ""));
  const content = escapeHtml(String(item.content ?? item.slug ?? "—"));
  const ws = String(item.work_status ?? "");
  const claimed = item.claimed_by ? `<div style="font-size:10px;color:#888;margin-top:3px">→ ${escapeHtml(String(item.claimed_by))}</div>` : "";

  const extraFields = (columns ?? []).filter(c => !["slug","content","work_status","claimed_by"].includes(c));
  const extras = extraFields.map(f => {
    const val = resolveField(item, f);
    if (val == null || val === "") return "";
    return `<div style="font-size:10px;color:#aaa;margin-top:2px"><span style="color:#666">${escapeHtml(f.split(".").pop() ?? f)}:</span> ${escapeHtml(String(val))}</div>`;
  }).join("");

  return `<div style="background:#242424;border:1px solid #3a3a3a;border-radius:4px;padding:9px 11px;cursor:pointer" onclick="window.location='/${slug}'">
    <div style="font-size:12px;font-weight:600;color:#fff;margin-bottom:3px">${content}</div>
    <div style="font-family:monospace;font-size:9px;color:#666">${slug}</div>
    ${ws ? `<div style="margin-top:5px">${statusBadge(ws)}</div>` : ""}
    ${claimed}
    ${extras}
  </div>`;
}

function renderKanban(result: SurfaceResult): string {
  // Find first group_by result (an object whose values are arrays)
  let groups: Record<string, unknown[]> | null = null;
  for (const val of Object.values(result.data)) {
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      const entries = Object.entries(val as Record<string, unknown>);
      if (entries.length > 0 && Array.isArray(entries[0][1])) {
        groups = val as Record<string, unknown[]>;
        break;
      }
    }
  }

  if (!groups) {
    return "<p style='color:#aaa;font-style:italic'>No grouped data found.</p>";
  }

  const colOrder = ["ready","in-progress","blocked","review","done","inbox","archived","dissolved"];
  const allKeys = Object.keys(groups);
  const ordered = [
    ...colOrder.filter(k => allKeys.includes(k)),
    ...allKeys.filter(k => !colOrder.includes(k)),
  ].filter(k => groups![k]?.length > 0);

  if (ordered.length === 0) {
    return "<p style='color:#aaa;font-style:italic'>All columns empty.</p>";
  }

  const cols = ordered.map(key => {
    const items = (groups![key] ?? []) as Record<string, unknown>[];
    const cards = items.map(item => renderCard(item, result.columns)).join("\n");
    const color = STATUS_COLORS[key] ?? "#6b7280";
    return `<div style="min-width:220px;max-width:260px;flex-shrink:0">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:${color};padding:4px 0 8px;border-bottom:2px solid ${color}44;margin-bottom:8px">${escapeHtml(key)} <span style="font-size:9px;color:#666;font-weight:400">${items.length}</span></div>
      <div style="display:flex;flex-direction:column;gap:6px">${cards}</div>
    </div>`;
  }).join("\n");

  return `<div style="display:flex;gap:16px;overflow-x:auto;padding-bottom:12px;align-items:flex-start">${cols}</div>`;
}

function renderCardGrid(result: SurfaceResult): string {
  // Find the primary array
  let items: Record<string, unknown>[] = [];
  for (const val of Object.values(result.data)) {
    if (Array.isArray(val) && val.length > 0) {
      items = val as Record<string, unknown>[];
      break;
    }
  }

  if (items.length === 0) {
    return "<p style='color:#aaa;font-style:italic'>No items found.</p>";
  }

  const cards = items.map(item => renderCard(item, result.columns)).join("\n");
  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">${cards}</div>`;
}

function renderTable(result: SurfaceResult): string {
  let items: Record<string, unknown>[] = [];
  for (const val of Object.values(result.data)) {
    if (Array.isArray(val) && val.length > 0) {
      items = val as Record<string, unknown>[];
      break;
    }
  }

  if (items.length === 0) {
    return "<p style='color:#aaa;font-style:italic'>No items found.</p>";
  }

  const cols = result.columns ?? ["slug","content","work_status","claimed_by"];
  const heads = cols.map(c => `<th style="text-align:left;padding:.3em .7em;font-size:10px;color:#888;font-weight:500;border-bottom:1px solid #3a3a3a">${escapeHtml(c.split(".").pop() ?? c).toUpperCase()}</th>`).join("");
  const rows = items.map(item => {
    const cells = cols.map(c => {
      const val = resolveField(item, c);
      const s = val == null ? "" : String(val);
      if (c === "work_status" && s) return `<td style="padding:.3em .7em">${statusBadge(s)}</td>`;
      if (c === "slug") return `<td style="padding:.3em .7em"><a href="/${escapeHtml(s)}" style="color:#0098fd;font-family:monospace;font-size:11px">${escapeHtml(s)}</a></td>`;
      return `<td style="padding:.3em .7em;font-size:12px">${escapeHtml(s)}</td>`;
    }).join("");
    return `<tr style="border-bottom:1px solid #2a2a2a">${cells}</tr>`;
  }).join("");

  return `<div style="font-size:11px;color:#666;margin-bottom:8px">${items.length} item${items.length === 1 ? "" : "s"}</div>
  <table style="width:100%;border-collapse:collapse">
    <thead><tr>${heads}</tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderList(result: SurfaceResult): string {
  let items: Record<string, unknown>[] = [];
  for (const val of Object.values(result.data)) {
    if (Array.isArray(val) && val.length > 0) {
      items = val as Record<string, unknown>[];
      break;
    }
  }

  if (items.length === 0) {
    return "<p style='color:#aaa;font-style:italic'>No items found.</p>";
  }

  const rows = items.map(item => {
    const slug = escapeHtml(String(item.slug ?? ""));
    const content = escapeHtml(String(item.content ?? item.slug ?? "—"));
    const ws = String(item.work_status ?? "");
    return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #2a2a2a">
      <a href="/${slug}" style="color:#fff;text-decoration:none;font-size:13px;flex:1">${content}</a>
      ${ws ? statusBadge(ws) : ""}
      ${item.claimed_by ? `<span style="font-size:10px;color:#666">${escapeHtml(String(item.claimed_by))}</span>` : ""}
    </div>`;
  }).join("");

  return `<div>${rows}</div>`;
}

function renderDashboard(result: SurfaceResult): string {
  const sections: string[] = [];

  for (const [stepId, val] of Object.entries(result.data)) {
    if (Array.isArray(val)) {
      const items = val as Record<string, unknown>[];
      if (items.length === 0) continue;
      const rows = items.slice(0, 8).map(item => {
        const slug = escapeHtml(String(item.slug ?? ""));
        const rawContent = String(item.content ?? item.event_kind ?? slug);
        const firstLine = rawContent.split("\n")[0].replace(/^#+\s*/, "").replace(/\*\*/g, "").slice(0, 90);
        const content = escapeHtml(firstLine || slug);
        const ws = String(item.work_status ?? "");
        return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #2a2a2a;font-size:12px">
          <a href="/${slug}" style="color:#fff;text-decoration:none;flex:1">${content}</a>
          ${ws ? statusBadge(ws) : ""}
        </div>`;
      }).join("");
      sections.push(`<div style="margin-bottom:20px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#888;margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid #3a3a3a">${escapeHtml(stepId)}</div>
        ${rows}
      </div>`);
    }
  }

  return sections.length > 0
    ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">${sections.join("")}</div>`
    : "<p style='color:#aaa;font-style:italic'>No data.</p>";
}

function renderSurface(result: SurfaceResult): string {
  switch (result.render_shape) {
    case "kanban":        return renderKanban(result);
    case "card-grid":     return renderCardGrid(result);
    case "table":         return renderTable(result);
    case "list":          return renderList(result);
    case "dashboard":     return renderDashboard(result);
    case "activity-stream": return renderList(result);
    default:              return renderCardGrid(result);
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const fragment = req.nextUrl.searchParams.get("f") === "1";

  const sb = getServerSupabase();
  const { data: node, error } = await sb
    .schema("context_os")
    .from("nodes")
    .select("id, slug, node_type, status, work_status, content, tags, scope, payload")
    .eq("slug", slug)
    .single();

  if (error || !node) {
    return new NextResponse(null, { status: 404 });
  }

  const n = node as {
    id: string;
    slug: string;
    node_type: string;
    status: string;
    work_status: string;
    content: string | null;
    tags: string[] | null;
    scope: string;
    payload: Record<string, unknown>;
  };

  let contentHtml: string;
  const payload = n.payload ?? {};

  // Walk-executor surface: execute steps and render by shape
  if (Array.isArray(payload.steps) && (payload.steps as unknown[]).length > 0) {
    const urlParams: Record<string, string> = {};
    req.nextUrl.searchParams.forEach((v, k) => { if (k !== "f") urlParams[k] = v; });

    const spec: SurfaceSpec = {
      title: typeof payload.title === "string" ? payload.title : undefined,
      render_shape: String(payload.render_shape ?? "card-grid") as SurfaceSpec["render_shape"],
      columns: Array.isArray(payload.columns) ? payload.columns as string[] : undefined,
      group_by: typeof payload.group_by === "string" ? payload.group_by : undefined,
      steps: payload.steps as SurfaceSpec["steps"],
    };

    try {
      const result = await executeSurface(spec, slug, urlParams);
      contentHtml = renderSurface(result);
      // Fire-and-forget: record that this surface was rendered
      void sb.schema("context_os").from("events").insert({
        event_kind: "viewer-rendered",
        actor: "viewer",
        subject_node_id: n.id,
        payload: { slot: "main", slug, rendered_at: new Date().toISOString() },
        phase: "stake",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      contentHtml = `<p style="color:#ef4444;font-family:monospace;font-size:12px">Surface error: ${escapeHtml(msg)}</p>`;
    }

  // Dynamic contacts query — legacy special case
  } else if (payload.query_contacts === true) {
    const { data: contacts } = await sb
      .schema("context_os")
      .from("nodes")
      .select("slug,content,payload,tags,created_at")
      .contains("tags", ["contact"])
      .eq("node_type", "entity")
      .order("created_at", { ascending: false })
      .limit(100);

    if (!contacts || contacts.length === 0) {
      contentHtml = "<p style='color:#aaa;font-style:italic'>No contacts yet. POST to /api/contact-ingress to add one.</p>";
    } else {
      const rows = (contacts as {
        slug: string;
        content: string | null;
        payload: Record<string, unknown>;
        tags: string[] | null;
        created_at: string;
      }[]).map(c => {
        const p = c.payload ?? {};
        const name = escapeHtml(String(p.name ?? c.slug));
        const company = escapeHtml(String(p.company ?? "—"));
        const email = escapeHtml(String(p.email ?? "—"));
        const source = escapeHtml(String(p.source ?? "—"));
        const tags = escapeHtml((c.tags ?? []).filter(t => !["contact","demo"].includes(t)).join(", ") || "—");
        const safeSlug = escapeHtml(c.slug);
        return `<tr>
          <td><a href="/${safeSlug}" style="color:#0098fd;text-decoration:none;font-family:monospace">${name}</a></td>
          <td>${company}</td>
          <td style="font-size:11px">${email}</td>
          <td><span style="font-family:monospace;font-size:10px;border:1px solid #3a3a3a;padding:1px 5px;color:#d8d8dc">${source}</span></td>
          <td style="font-size:11px;color:#888">${tags}</td>
        </tr>`;
      }).join("\n");

      contentHtml = `
        <div style="margin-bottom:12px;font-size:12px;color:#888">${contacts.length} contact${contacts.length === 1 ? "" : "s"}</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="border-bottom:1px solid #3a3a3a">
              <th style="text-align:left;padding:.35em .7em;font-size:11px;color:#888;font-weight:500">NAME</th>
              <th style="text-align:left;padding:.35em .7em;font-size:11px;color:#888;font-weight:500">COMPANY</th>
              <th style="text-align:left;padding:.35em .7em;font-size:11px;color:#888;font-weight:500">EMAIL</th>
              <th style="text-align:left;padding:.35em .7em;font-size:11px;color:#888;font-weight:500">SOURCE</th>
              <th style="text-align:left;padding:.35em .7em;font-size:11px;color:#888;font-weight:500">TAGS</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`;
    }

  // Prose fallback
  } else {
    contentHtml = n.content
      ? await marked.parse(n.content)
      : "<p style='color:#aaa;font-style:italic'>no content</p>";
  }

  // Surface title from payload or node slug
  const displayTitle = typeof payload.title === "string" ? payload.title : n.slug;

  const tags = (n.tags ?? [])
    .map(t => `<span style="font-family:monospace;font-size:10px;border:1px solid #3a3a3a;padding:1px 6px;color:#d8d8dc">${escapeHtml(t)}</span>`)
    .join(" ");

  const css = `
  .cxs *{box-sizing:border-box;margin:0;padding:0}
  .cxs{background:#1a1a1a;color:#fff;font-family:system-ui,-apple-system,sans-serif;font-size:13px;line-height:1.6;padding:16px 20px}
  .cxs .header{margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #3a3a3a}
  .cxs .slug{font-family:monospace;font-size:13px;font-weight:700;color:#fff}
  .cxs .surface-title{font-size:16px;font-weight:700;color:#fff;margin-bottom:4px}
  .cxs .badges{display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap}
  .cxs .badge{font-family:monospace;font-size:9px;border:1px solid #3a3a3a;padding:1px 6px;color:#d8d8dc;text-transform:uppercase;letter-spacing:.05em}
  .cxs .badge-canon{border-color:#166534;color:#4ade80}
  .cxs .scope{font-family:monospace;font-size:9px;color:#aaaaaa;margin-top:4px}
  .cxs .content{color:#fff}
  .cxs .content h1,.cxs .content h2,.cxs .content h3{font-weight:600;margin:1.1em 0 .4em;line-height:1.3}
  .cxs .content h1{font-size:1.15em}
  .cxs .content h2{font-size:1.05em}
  .cxs .content h3{font-size:1em}
  .cxs .content p{margin:.6em 0}
  .cxs .content p:first-child{margin-top:0}
  .cxs .content strong{font-weight:600}
  .cxs .content em{font-style:italic;color:#d8d8dc}
  .cxs .content code{font-family:monospace;font-size:.85em;background:rgba(255,255,255,.07);padding:.1em .4em}
  .cxs .content pre{background:rgba(255,255,255,.04);border:1px solid #3a3a3a;padding:.75em 1em;overflow-x:auto;margin:.8em 0}
  .cxs .content pre code{background:none;padding:0}
  .cxs .content ul,.cxs .content ol{padding-left:1.4em;margin:.6em 0}
  .cxs .content li{margin:.2em 0}
  .cxs .content blockquote{border-left:2px solid #3a3a3a;padding-left:1em;color:#d8d8dc;margin:.6em 0}
  .cxs .content a{color:#0098fd}
  .cxs .content hr{border:none;border-top:1px solid #3a3a3a;margin:1.2em 0}
  .cxs .content table{width:100%;border-collapse:collapse;font-size:.9em;margin:.8em 0}
  .cxs .content th,.cxs .content td{border:1px solid #3a3a3a;padding:.35em .7em;text-align:left}
  .cxs .content th{font-weight:600;background:rgba(255,255,255,.04)}
  .cxs .tags{margin-top:12px;display:flex;flex-wrap:wrap;gap:4px}`;

  const isSurface = Array.isArray(payload.steps);
  const headerTitle = isSurface && displayTitle !== n.slug
    ? `<div class="surface-title">${escapeHtml(displayTitle)}</div><div class="slug" style="font-size:10px;color:#666;font-weight:400">${escapeHtml(n.slug)}</div>`
    : `<div class="slug">${escapeHtml(n.slug)}</div>`;

  const shapeLabel = isSurface
    ? `<span class="badge" style="border-color:#1e40af;color:#60a5fa">${escapeHtml(String(payload.render_shape ?? "surface"))}</span>`
    : "";

  const body = `
  <div class="header">
    ${headerTitle}
    <div class="badges">
      <span class="badge">${escapeHtml(n.node_type)}</span>
      <span class="badge ${n.status === "canon" ? "badge-canon" : ""}">${escapeHtml(n.status)}</span>
      ${shapeLabel}
    </div>
    <div class="scope">${escapeHtml(n.scope)}</div>
  </div>
  <div class="content">${contentHtml}</div>
  ${tags ? `<div class="tags">${tags}</div>` : ""}`;

  const html = fragment
    ? `<style>${css}</style><div class="cxs">${body}</div>`
    : `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body class="cxs">${body}</body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
