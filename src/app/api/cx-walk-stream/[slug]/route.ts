import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const { searchParams } = req.nextUrl;
  const relationType = searchParams.get("relation_type") ?? "implements";
  const direction = searchParams.get("direction") ?? "both";
  const maxDepth = searchParams.get("max_depth") ?? "6";

  const eventsUrl = `/api/cx-walk-events?slug=${encodeURIComponent(slug)}&relation_type=${encodeURIComponent(relationType)}&direction=${encodeURIComponent(direction)}&max_depth=${encodeURIComponent(maxDepth)}`;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #1a1a1a; color: #d8d8dc; font-family: system-ui, -apple-system, sans-serif; padding: 20px 24px; height: 100vh; overflow: hidden; display: flex; flex-direction: column; gap: 12px; }
  .header { flex-shrink: 0; }
  .title { font-family: monospace; font-size: 16px; font-weight: 700; color: #fff; }
  .meta { font-family: monospace; font-size: 10px; color: #555; margin-top: 3px; }
  #progress { font-family: monospace; font-size: 11px; color: #aaaaaa; flex-shrink: 0; min-height: 16px; }
  #progress.done { color: #4ade80; }
  #nodes { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; }
  .depth-sep { font-family: monospace; font-size: 10px; color: #3a3a3a; text-transform: uppercase; letter-spacing: .1em; padding: 12px 0 6px; border-top: 1px solid #2a2a2a; margin-top: 4px; }
  .depth-sep:first-child { margin-top: 0; border-top: none; padding-top: 0; }
  .node-row { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
  .node-row.new { animation: slide-in .25s ease; }
  .node-slug { font-family: monospace; font-size: 14px; color: #fff; }
  .node-type { font-family: monospace; font-size: 9px; padding: 1px 5px; text-transform: uppercase; letter-spacing: .05em; border: 1px solid; flex-shrink: 0; }
  .t-mission    { color: #60a5fa; border-color: #1d4ed8; }
  .t-principle  { color: #a78bfa; border-color: #5b21b6; }
  .t-practice   { color: #4ade80; border-color: #166534; }
  .t-policy     { color: #fbbf24; border-color: #92400e; }
  .t-task       { color: #f87171; border-color: #991b1b; }
  .t-document   { color: #d8d8dc; border-color: #3a3a3a; }
  .t-pattern    { color: #f0abfc; border-color: #701a75; }
  .t-glimmer    { color: #67e8f9; border-color: #0e7490; }
  .t-finding    { color: #fb923c; border-color: #7c2d12; }
  .t-other      { color: #aaaaaa; border-color: #3a3a3a; }
  @keyframes slide-in { from { opacity:0; transform:translateX(-6px); } to { opacity:1; transform:none; } }
</style>
</head>
<body>
<div class="header">
  <div class="title">${slug}</div>
  <div class="meta">${relationType} · ${direction} · depth ${maxDepth}</div>
</div>
<div id="progress">connecting…</div>
<div id="nodes"></div>
<script>
const eventsUrl = ${JSON.stringify(eventsUrl)};
const nodesEl = document.getElementById('nodes');
const progressEl = document.getElementById('progress');

const TYPE_CLASS = {
  mission:'t-mission', principle:'t-principle', practice:'t-practice',
  policy:'t-policy', task:'t-task', document:'t-document',
  pattern:'t-pattern', glimmer:'t-glimmer', finding:'t-finding',
};

const es = new EventSource(eventsUrl);

es.onmessage = function(e) {
  const msg = JSON.parse(e.data);
  if (msg.done) {
    progressEl.textContent = 'complete — ' + msg.total_nodes + ' nodes';
    progressEl.className = 'done';
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
    const sep = document.createElement('div');
    sep.className = 'depth-sep';
    sep.textContent = 'depth ' + msg.depth + ' · ' + msg.new_nodes.length + ' nodes';
    nodesEl.appendChild(sep);
    msg.new_nodes.forEach(function(n, i) {
      const row = document.createElement('div');
      row.className = 'node-row new';
      row.style.animationDelay = (i * 20) + 'ms';
      const tc = TYPE_CLASS[n.node_type] || 't-other';
      row.innerHTML = '<span class="node-slug">' + escHtml(n.slug) + '</span>'
        + '<span class="node-type ' + tc + '">' + escHtml(n.node_type) + '</span>';
      nodesEl.appendChild(row);
    });
    nodesEl.scrollTop = nodesEl.scrollHeight;
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
