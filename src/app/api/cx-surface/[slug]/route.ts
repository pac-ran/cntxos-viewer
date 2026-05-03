import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { marked } from "marked";

export const dynamic = "force-dynamic";

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
    .select("slug, node_type, status, work_status, content, tags, scope, payload")
    .eq("slug", slug)
    .single();

  if (error || !node) {
    return new NextResponse(null, { status: 404 });
  }

  const n = node as {
    slug: string;
    node_type: string;
    status: string;
    work_status: string;
    content: string | null;
    tags: string[] | null;
    scope: string;
    payload: Record<string, unknown>;
  };

  const contentHtml = n.content
    ? await marked.parse(n.content)
    : "<p style='color:#aaa;font-style:italic'>no content</p>";

  const tags = (n.tags ?? [])
    .map(t => `<span style="font-family:monospace;font-size:10px;border:1px solid #3a3a3a;padding:1px 6px;color:#d8d8dc">${t}</span>`)
    .join(" ");

  const css = `
  .cxs *{box-sizing:border-box;margin:0;padding:0}
  .cxs{background:#1a1a1a;color:#fff;font-family:system-ui,-apple-system,sans-serif;font-size:13px;line-height:1.6;padding:16px 20px}
  .cxs .header{margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #3a3a3a}
  .cxs .slug{font-family:monospace;font-size:13px;font-weight:700;color:#fff}
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

  const body = `
  <div class="header">
    <div class="slug">${n.slug}</div>
    <div class="badges">
      <span class="badge">${n.node_type}</span>
      <span class="badge ${n.status === "canon" ? "badge-canon" : ""}">${n.status}</span>
    </div>
    <div class="scope">${n.scope}</div>
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
