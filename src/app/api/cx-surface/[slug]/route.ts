import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { marked } from "marked";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

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

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #1a1a1a;
    color: #ffffff;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
    line-height: 1.6;
    padding: 16px 20px;
    height: 100%;
    overflow-y: auto;
  }
  .header { margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid #3a3a3a; }
  .slug { font-family: monospace; font-size: 13px; font-weight: 700; color: #fff; }
  .badges { display: flex; gap: 6px; align-items: center; margin-top: 6px; flex-wrap: wrap; }
  .badge { font-family: monospace; font-size: 9px; border: 1px solid #3a3a3a; padding: 1px 6px; color: #d8d8dc; text-transform: uppercase; letter-spacing: .05em; }
  .badge-canon { border-color: #166534; color: #4ade80; }
  .scope { font-family: monospace; font-size: 9px; color: #aaaaaa; margin-top: 4px; }
  .content { color: #ffffff; }
  .content h1,.content h2,.content h3 { font-weight: 600; margin: 1.1em 0 .4em; line-height: 1.3; }
  .content h1 { font-size: 1.15em; }
  .content h2 { font-size: 1.05em; }
  .content h3 { font-size: 1em; }
  .content p { margin: .6em 0; }
  .content p:first-child { margin-top: 0; }
  .content strong { font-weight: 600; }
  .content em { font-style: italic; color: #d8d8dc; }
  .content code { font-family: monospace; font-size: .85em; background: rgba(255,255,255,.07); padding: .1em .4em; }
  .content pre { background: rgba(255,255,255,.04); border: 1px solid #3a3a3a; padding: .75em 1em; overflow-x: auto; margin: .8em 0; }
  .content pre code { background: none; padding: 0; }
  .content ul,.content ol { padding-left: 1.4em; margin: .6em 0; }
  .content li { margin: .2em 0; }
  .content blockquote { border-left: 2px solid #3a3a3a; padding-left: 1em; color: #d8d8dc; margin: .6em 0; }
  .content a { color: #0098fd; }
  .content hr { border: none; border-top: 1px solid #3a3a3a; margin: 1.2em 0; }
  .content table { width: 100%; border-collapse: collapse; font-size: .9em; margin: .8em 0; }
  .content th,.content td { border: 1px solid #3a3a3a; padding: .35em .7em; text-align: left; }
  .content th { font-weight: 600; background: rgba(255,255,255,.04); }
  .tags { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 4px; }
</style>
</head>
<body>
  <div class="header">
    <div class="slug">${n.slug}</div>
    <div class="badges">
      <span class="badge">${n.node_type}</span>
      <span class="badge ${n.status === "canon" ? "badge-canon" : ""}">${n.status}</span>
    </div>
    <div class="scope">${n.scope}</div>
  </div>
  <div class="content">${contentHtml}</div>
  ${tags ? `<div class="tags">${tags}</div>` : ""}
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
