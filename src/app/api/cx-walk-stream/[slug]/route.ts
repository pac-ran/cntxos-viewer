import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const { searchParams } = req.nextUrl;
  const relationType = searchParams.get("relation_type") ?? "implements";
  const direction = searchParams.get("direction") ?? "forward";
  const maxDepth = searchParams.get("max_depth") ?? "6";

  const eventsUrl = `/api/cx-walk-events?slug=${encodeURIComponent(slug)}&relation_type=${encodeURIComponent(relationType)}&direction=${encodeURIComponent(direction)}&max_depth=${encodeURIComponent(maxDepth)}`;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #1a1a1a; color: #d8d8dc; font-family: system-ui, -apple-system, sans-serif; font-size: 12px; line-height: 1.5; padding: 14px 18px; height: 100vh; overflow: hidden; display: flex; flex-direction: column; gap: 10px; }
  .header { display: flex; align-items: baseline; gap: 8px; flex-shrink: 0; }
  .title { font-family: monospace; font-size: 13px; font-weight: 700; color: #fff; }
  .meta { font-family: monospace; font-size: 9px; color: #aaaaaa; }
  #progress { font-family: monospace; font-size: 10px; color: #aaaaaa; flex-shrink: 0; }
  #nodes { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
  .node-row { display: flex; align-items: baseline; gap: 6px; }
  .node-slug { font-family: monospace; font-size: 11px; color: #d8d8dc; }
  .node-type { font-family: monospace; font-size: 9px; border: 1px solid #3a3a3a; padding: 0 4px; color: #aaaaaa; text-transform: uppercase; }
  .node-new { animation: fadein 0.3s ease; }
  .depth-label { font-family: monospace; font-size: 9px; color: #555; text-transform: uppercase; margin-top: 8px; margin-bottom: 2px; }
  @keyframes fadein { from { opacity: 0; transform: translateX(-4px); } to { opacity: 1; transform: none; } }
</style>
</head>
<body>
<div class="header">
  <span class="title">${slug}</span>
  <span class="meta">${relationType} · ${direction} · depth ${maxDepth}</span>
</div>
<div id="progress">connecting…</div>
<div id="nodes"></div>
<script>
const eventsUrl = ${JSON.stringify(eventsUrl)};
const nodesEl = document.getElementById('nodes');
const progressEl = document.getElementById('progress');

const es = new EventSource(eventsUrl);

es.onmessage = function(e) {
  const msg = JSON.parse(e.data);
  if (msg.done) {
    progressEl.textContent = 'complete — ' + msg.total_nodes + ' nodes';
    es.close();
    return;
  }
  if (msg.error) {
    progressEl.textContent = 'error: ' + msg.error;
    es.close();
    return;
  }
  progressEl.textContent = 'depth ' + msg.depth + ' — ' + msg.total_nodes + ' nodes…';
  if (msg.new_nodes && msg.new_nodes.length > 0) {
    const label = document.createElement('div');
    label.className = 'depth-label';
    label.textContent = 'depth ' + msg.depth;
    nodesEl.appendChild(label);
    for (const n of msg.new_nodes) {
      const row = document.createElement('div');
      row.className = 'node-row node-new';
      row.innerHTML = '<span class="node-slug">' + escHtml(n.slug) + '</span><span class="node-type">' + escHtml(n.node_type) + '</span>';
      nodesEl.appendChild(row);
    }
  }
};

es.onerror = function() {
  progressEl.textContent = 'stream error — check slug';
  es.close();
};

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
</script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
