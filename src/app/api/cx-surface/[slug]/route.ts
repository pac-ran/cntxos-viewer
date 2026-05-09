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

  // FIX 2026-05-09 (DL bug): if no pre-grouped data, auto-group from a flat array
  // using surface.group_by, or smart-default to work_status if any node has it,
  // else status. This lets surfaces declare render_shape="kanban" + group_by
  // without needing an explicit group_by step in payload.steps.
  if (!groups) {
    let items: Record<string, unknown>[] = [];
    for (const val of Object.values(result.data)) {
      if (Array.isArray(val) && val.length > 0) {
        items = val as Record<string, unknown>[];
        break;
      }
    }
    if (items.length > 0) {
      let field = result.group_by;
      if (!field) {
        field = items.some((n) => n && (n as Record<string, unknown>).work_status != null)
          ? "work_status"
          : "status";
      }
      const built: Record<string, unknown[]> = {};
      for (const item of items) {
        const pl = (item.payload ?? {}) as Record<string, unknown>;
        const key = String(resolveField(item, field) ?? resolveField(pl, field) ?? "other");
        if (!built[key]) built[key] = [];
        built[key].push(item);
      }
      groups = built;
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
    } else if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      const item = val as Record<string, unknown>;
      const pl = (item.payload ?? {}) as Record<string, unknown>;
      const rawName = String(pl.display_name ?? item.content ?? item.slug ?? stepId);
      const name = escapeHtml(rawName.split("\n")[0].replace(/^#+\s*/, "").replace(/\*\*/g, "").slice(0, 90));
      const kind = pl.kind ? `<span style="font-size:10px;color:#888;margin-left:6px">${escapeHtml(String(pl.kind))}</span>` : "";
      sections.push(`<div style="margin-bottom:20px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#888;margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid #3a3a3a">${escapeHtml(stepId)}</div>
        <div style="font-size:13px;color:#fff;padding:6px 0">${name}${kind}</div>
      </div>`);
    }
  }

  return sections.length > 0
    ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">${sections.join("")}</div>`
    : "<p style='color:#aaa;font-style:italic'>No data.</p>";
}

function renderActivityStream(result: SurfaceResult): string {
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
    const evpl = (item.payload ?? {}) as Record<string, unknown>;
    const headline = escapeHtml(String(evpl.note ?? evpl.question ?? evpl.summary ?? item.event_kind ?? "—").slice(0, 160));
    const actor = item.actor ? `<span style="font-size:10px;color:#888">${escapeHtml(String(item.actor))}</span>` : "";
    const ts = item.occurred_at
      ? `<span style="font-size:10px;color:#555">${escapeHtml(String(item.occurred_at).slice(0, 10))}</span>`
      : "";
    return `<div style="display:flex;flex-direction:column;gap:3px;padding:8px 0;border-bottom:1px solid #2a2a2a">
      <span style="color:#e5e5e5;font-size:13px;line-height:1.4">${headline}</span>
      <div style="display:flex;gap:8px">${actor}${ts}</div>
    </div>`;
  }).join("");

  return `<div>${rows}</div>`;
}

function renderApprovalQueue(result: SurfaceResult): string {
  // Collect proposal rows from any array in result.data
  let items: Record<string, unknown>[] = [];
  for (const val of Object.values(result.data)) {
    if (Array.isArray(val)) {
      items = val as Record<string, unknown>[];
      break;
    }
  }

  if (items.length === 0) {
    return "<p style='color:#aaa;font-style:italic;padding:12px 0'>No pending proposals. Queue is clear.</p>";
  }

  const rows = items.map(item => {
    const pl = (item.payload ?? {}) as Record<string, unknown>;

    // proposal_id: prefer top-level field from RPC, fall back to payload
    const proposalId = escapeHtml(String(item.proposal_id ?? pl.proposal_id ?? item.id ?? "—"));

    // agent: actor field
    const agent = escapeHtml(String(item.actor ?? pl.actor ?? "—"));

    // action description: action_slug > action_kind > payload.action_slug
    const actionSlug = escapeHtml(String(
      item.action_slug ?? pl.action_slug ?? pl.action_kind ?? "—"
    ));

    // subject: subject_slug / subject_content from RPC
    const subjectSlug = item.subject_slug ? escapeHtml(String(item.subject_slug)) : "";
    const subjectContent = item.subject_content
      ? escapeHtml(String(item.subject_content).slice(0, 80))
      : "";

    // date
    const ts = item.occurred_at
      ? escapeHtml(String(item.occurred_at).slice(0, 16).replace("T", " "))
      : "—";

    // expires
    const expires = item.expires_at
      ? `<span style="font-size:10px;color:#f59e0b">expires ${escapeHtml(String(item.expires_at).slice(0, 10))}</span>`
      : "";

    const subjectLine = subjectSlug
      ? `<div style="font-size:10px;color:#666;margin-top:2px">→ <span style="color:#888">${subjectSlug}</span>${subjectContent ? `: ${subjectContent}` : ""}</div>`
      : "";

    return `<div style="background:#1e1e1e;border:1px solid #3a3a3a;border-radius:4px;padding:10px 12px;display:flex;align-items:flex-start;gap:12px">
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;color:#e5e5e5;margin-bottom:3px">${actionSlug}</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span style="font-family:monospace;font-size:10px;color:#0098fd">${agent}</span>
          <span style="font-size:10px;color:#555">${ts}</span>
          ${expires}
        </div>
        ${subjectLine}
        <div style="font-family:monospace;font-size:9px;color:#4a4a4a;margin-top:3px">id:${proposalId}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;align-items:center">
        <form method="POST" action="/api/cx-event" style="margin:0" onsubmit="return handleApprovalSubmit(event)">
          <input type="hidden" name="event_kind" value="proposal-approved" />
          <input type="hidden" name="proposal_id" value="${proposalId}" />
          <input type="hidden" name="actor" value="cc" />
          <button type="submit"
            style="background:#166534;color:#4ade80;border:1px solid #166534;border-radius:3px;padding:4px 10px;font-size:11px;font-family:monospace;cursor:pointer;font-weight:600"
          >Approve</button>
        </form>
        <form method="POST" action="/api/cx-event" style="margin:0" onsubmit="return handleApprovalSubmit(event)">
          <input type="hidden" name="event_kind" value="proposal-denied" />
          <input type="hidden" name="proposal_id" value="${proposalId}" />
          <input type="hidden" name="actor" value="cc" />
          <button type="submit"
            style="background:#3b0000;color:#ef4444;border:1px solid #7f1d1d;border-radius:3px;padding:4px 10px;font-size:11px;font-family:monospace;cursor:pointer;font-weight:600"
          >Deny</button>
        </form>
      </div>
    </div>`;
  }).join("\n");

  const script = `<script>
function handleApprovalSubmit(e) {
  e.preventDefault();
  var form = e.currentTarget;
  var data = {};
  new FormData(form).forEach(function(v,k){ data[k]=v; });
  var btn = form.querySelector('button[type=submit]');
  var originalLabel = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  fetch('/api/cx-event', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(data)
  }).then(function(r){ return r.json(); }).then(function(res) {
    if (res.ok) {
      var row = form.closest('div[style*="background:#1e1e1e"]');
      if (row) { row.style.opacity = '0.4'; row.style.pointerEvents = 'none'; }
    } else {
      if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
      alert('Error: ' + (res.error || 'unknown'));
    }
  }).catch(function(err) {
    if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
    alert('Network error: ' + err);
  });
  return false;
}
</script>`;

  return `${script}<div style="display:flex;flex-direction:column;gap:8px">
    <div style="font-size:10px;color:#888;margin-bottom:4px">${items.length} pending proposal${items.length === 1 ? "" : "s"}</div>
    ${rows}
  </div>`;
}

function renderFileBrowser(result: SurfaceResult): string {
  let items: Record<string, unknown>[] = [];
  for (const val of Object.values(result.data)) {
    if (Array.isArray(val) && val.length > 0) {
      items = val as Record<string, unknown>[];
      break;
    }
  }
  if (items.length === 0) return "<p style='color:#aaa;font-style:italic'>No files found.</p>";

  const rows = items.map(item => {
    const name = escapeHtml(String(item.name ?? ""));
    const desc = escapeHtml(String(item.description ?? ""));
    const isDir = Boolean(item.is_dir);
    const bytes = Number(item.size ?? 0);
    const size = bytes > 0 ? (bytes >= 1024 ? `${Math.round(bytes / 1024)}KB` : `${bytes}B`) : "";
    const mtime = escapeHtml(String(item.mtime ?? "").slice(0, 10));
    const icon = isDir ? "▸" : "·";
    const nameColor = isDir ? "#f59e0b" : "#7dd3fc";
    return `<div style="display:grid;grid-template-columns:16px 1fr 60px 88px;gap:8px;align-items:baseline;padding:6px 0;border-bottom:1px solid #222">
      <span style="color:#555;font-size:11px">${icon}</span>
      <div>
        <span style="font-family:monospace;font-size:12px;color:${nameColor}">${name}</span>
        ${desc ? `<div style="font-size:11px;color:#555;margin-top:2px;font-family:sans-serif">${desc}</div>` : ""}
      </div>
      <span style="font-size:10px;color:#444;text-align:right;font-family:monospace">${escapeHtml(size)}</span>
      <span style="font-size:10px;color:#444;text-align:right;font-family:monospace">${mtime}</span>
    </div>`;
  }).join("");

  const header = `<div style="display:grid;grid-template-columns:16px 1fr 60px 88px;gap:8px;padding:4px 0 8px;border-bottom:2px solid #333;margin-bottom:2px">
    <span></span>
    <span style="font-size:9px;color:#555;font-weight:700;letter-spacing:.08em">NAME / DESCRIPTION</span>
    <span style="font-size:9px;color:#555;font-weight:700;letter-spacing:.08em;text-align:right">SIZE</span>
    <span style="font-size:9px;color:#555;font-weight:700;letter-spacing:.08em;text-align:right">MODIFIED</span>
  </div>`;

  return `<div style="font-family:monospace">${header}${rows}</div>`;
}

function renderMermaid(result: SurfaceResult): string {
  // Extract diagram string from result.data (string or {diagram: string})
  let diagram = "";
  const raw = result.data.diagram;
  if (typeof raw === "string") {
    diagram = raw;
  } else if (raw !== null && typeof raw === "object") {
    const d = (raw as Record<string, unknown>).diagram;
    if (typeof d === "string") diagram = d;
  }

  const safeDiagram = escapeHtml(diagram);
  const srcdoc = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>body{margin:0;padding:12px;background:#1a1a1a}svg{max-width:100%;height:auto}</style>
</head>
<body>
<div class="mermaid">${safeDiagram}</div>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<script>mermaid.initialize({startOnLoad:true});</script>
</body>
</html>`.replace(/"/g, "&quot;");

  return `<iframe srcdoc="${srcdoc}" sandbox="allow-scripts" style="width:100%;height:400px;border:none;background:#1a1a1a" frameborder="0"></iframe>`;
}

function renderClusterState(result: SurfaceResult): string {
  let data: Record<string, unknown> = {};
  for (const val of Object.values(result.data)) {
    if (val !== null && typeof val === "object" && !Array.isArray(val) && "sessions" in (val as object)) {
      data = val as Record<string, unknown>;
      break;
    }
  }

  const sessions = (data.sessions as string[] | undefined) ?? [];
  const lastCmd = (data.last_cmd as Record<string, unknown> | undefined) ?? {};
  const spawnLog = (data.spawn_log as string[] | undefined) ?? [];

  const sessionPills = sessions.length > 0
    ? sessions.map(s => `<span style="font-family:monospace;font-size:11px;padding:3px 8px;border-radius:3px;background:#1e3a5f;color:#7dd3fc;border:1px solid #1e40af55">${escapeHtml(s)}</span>`).join(" ")
    : `<span style="color:#555;font-style:italic;font-size:11px">none</span>`;

  const cmdTs = lastCmd.timestamp ? escapeHtml(String(lastCmd.timestamp).replace("T", " ").replace("Z", " UTC")) : "—";
  const cmdAction = lastCmd.action ? escapeHtml(String(lastCmd.action)) : "—";
  const cmdAgent = lastCmd.agent ? `<span style="color:#f59e0b;font-family:monospace"> → ${escapeHtml(String(lastCmd.agent))}</span>` : "";

  const logRows = spawnLog.length > 0
    ? spawnLog.map(line => {
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(line); } catch { /* raw line */ }
        const ts = parsed.ts ? escapeHtml(String(parsed.ts).slice(11, 19)) : "";
        const msg = parsed.msg ? escapeHtml(String(parsed.msg)) : escapeHtml(line.slice(0, 120));
        const level = String(parsed.level ?? "");
        const levelColor = level === "error" ? "#ef4444" : level === "warn" ? "#f59e0b" : "#555";
        return `<div style="display:flex;gap:10px;padding:4px 0;border-bottom:1px solid #222;font-size:11px;font-family:monospace">
          <span style="color:#444;flex-shrink:0;width:52px">${ts}</span>
          ${level ? `<span style="color:${levelColor};flex-shrink:0;width:36px">${escapeHtml(level)}</span>` : ""}
          <span style="color:#aaa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${msg}</span>
        </div>`;
      }).join("")
    : `<div style="color:#555;font-style:italic;font-size:11px;padding:8px 0">no log entries</div>`;

  return `<div style="display:flex;flex-direction:column;gap:20px">
    <div>
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#555;margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid #333">ACTIVE SESSIONS (${sessions.length})</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${sessionPills}</div>
    </div>
    <div>
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#555;margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid #333">LAST COMMAND</div>
      <div style="font-family:monospace;font-size:12px;color:#e5e5e5">${cmdAction}${cmdAgent}</div>
      <div style="font-size:10px;color:#555;margin-top:3px">${cmdTs}</div>
    </div>
    <div>
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#555;margin-bottom:4px;padding-bottom:5px;border-bottom:1px solid #333">SPAWN LOG (last ${spawnLog.length})</div>
      ${logRows}
    </div>
  </div>`;
}

function renderIntercomEvents(result: SurfaceResult): string {
  let data: Record<string, unknown> = {};
  for (const val of Object.values(result.data)) {
    if (val !== null && typeof val === "object" && !Array.isArray(val) && "forwarded_count" in (val as object)) {
      data = val as Record<string, unknown>;
      break;
    }
  }

  const stateAge = Number(data.state_age_seconds ?? -1);
  const forwardedCount = Number(data.forwarded_count ?? 0);
  const lastForwardedAt = String(data.last_forwarded_at ?? "");
  const recentForwarded = (data.recent_forwarded as Record<string, unknown>[] | undefined) ?? [];
  const recentErrors = (data.recent_errors as Record<string, unknown>[] | undefined) ?? [];

  // Status pill
  const stateAgeLabel = stateAge < 0 ? "no state" : stateAge < 300 ? `${stateAge}s ago` : `${Math.round(stateAge / 60)}m ago`;
  const stateColor = stateAge < 0 ? "#6b7280" : stateAge < 300 ? "#22c55e" : stateAge < 1800 ? "#f59e0b" : "#ef4444";
  const statusPill = `<span style="font-family:monospace;font-size:11px;padding:3px 8px;border-radius:3px;background:${stateColor}22;color:${stateColor};border:1px solid ${stateColor}55">state: ${escapeHtml(stateAgeLabel)}</span>`;

  // Last forward
  const lastFwdDisplay = lastForwardedAt
    ? `<span style="font-size:11px;color:#888;font-family:monospace">${escapeHtml(lastForwardedAt.slice(0, 19).replace("T", " "))} UTC</span>`
    : `<span style="font-size:11px;color:#555;font-style:italic">none yet</span>`;

  // Recent forwarded rows
  const fwdRows = recentForwarded.length > 0
    ? [...recentForwarded].reverse().map(e => {
        const ts = String(e.ts ?? "").slice(11, 19);
        const eventId = String(e.event_id ?? "").slice(0, 8);
        const occurredAt = String(e.occurred_at ?? "").slice(0, 16).replace("T", " ");
        const chars = Number(e.chars ?? 0);
        return `<div style="display:grid;grid-template-columns:52px 70px 1fr 50px;gap:8px;align-items:baseline;padding:5px 0;border-bottom:1px solid #222;font-size:11px;font-family:monospace">
          <span style="color:#444">${escapeHtml(ts)}</span>
          <span style="color:#3b82f6">${escapeHtml(eventId)}…</span>
          <span style="color:#aaa">${escapeHtml(occurredAt)}</span>
          <span style="color:#555;text-align:right">${chars}ch</span>
        </div>`;
      }).join("")
    : `<div style="color:#555;font-style:italic;font-size:11px;padding:8px 0">no forwarded events yet</div>`;

  // Error rows
  const errSection = recentErrors.length > 0
    ? `<div>
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#ef4444;margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid #3a2a2a">RECENT ERRORS (${recentErrors.length})</div>
        ${recentErrors.map(e => {
          const ts = String(e.ts ?? "").slice(11, 19);
          const body = String(e.body ?? "").slice(0, 120);
          return `<div style="font-size:10px;font-family:monospace;padding:4px 0;border-bottom:1px solid #2a2020;color:#ef4444"><span style="color:#444">${escapeHtml(ts)}</span>  ${escapeHtml(body)}</div>`;
        }).join("")}
      </div>`
    : "";

  return `<div style="display:flex;flex-direction:column;gap:20px">
    <div>
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#555;margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid #333">BRIDGE STATUS</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
        ${statusPill}
        <span style="font-size:10px;color:#555">${forwardedCount} forwarded total</span>
      </div>
      <div style="margin-top:6px;font-size:10px;color:#555">last forward: ${lastFwdDisplay}</div>
    </div>
    <div>
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#555;margin-bottom:4px;padding-bottom:5px;border-bottom:1px solid #333">
        FORWARDED TO RANDY (${recentForwarded.length} shown)
      </div>
      <div style="display:grid;grid-template-columns:52px 70px 1fr 50px;gap:8px;padding:3px 0 6px;border-bottom:1px solid #2a2a2a;margin-bottom:2px">
        <span style="font-size:9px;color:#444;font-weight:700">TIME</span>
        <span style="font-size:9px;color:#444;font-weight:700">EVENT ID</span>
        <span style="font-size:9px;color:#444;font-weight:700">OCCURRED AT</span>
        <span style="font-size:9px;color:#444;font-weight:700;text-align:right">SIZE</span>
      </div>
      ${fwdRows}
    </div>
    ${errSection}
  </div>`;
}

function renderBoxHealth(result: SurfaceResult): string {
  let data: Record<string, unknown> = {};
  for (const val of Object.values(result.data)) {
    if (val !== null && typeof val === "object" && !Array.isArray(val) && "uptime" in (val as object)) {
      data = val as Record<string, unknown>;
      break;
    }
  }

  const uptime = escapeHtml(String(data.uptime ?? "—"));
  const disk = escapeHtml(String(data.disk ?? "—"));
  const memory = escapeHtml(String(data.memory ?? "—"));
  const errors = (data.recent_errors as string[] | undefined) ?? [];

  const section = (label: string, content: string, color = "#555") =>
    `<div>
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:${escapeHtml(color)};margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid #333">${label}</div>
      ${content}
    </div>`;

  const mono = (s: string) =>
    `<pre style="font-family:monospace;font-size:11px;color:#aaa;white-space:pre-wrap;word-break:break-all;background:#111;padding:8px;border:1px solid #2a2a2a">${s}</pre>`;

  const errSection = errors.length > 0
    ? section("RECENT ERRORS (last 1h)", errors.map(l => `<div style="font-family:monospace;font-size:10px;color:#ef4444;padding:3px 0;border-bottom:1px solid #2a2020">${escapeHtml(l)}</div>`).join(""), "#ef4444")
    : section("RECENT ERRORS (last 1h)", `<div style="font-size:11px;color:#22c55e;font-style:italic">no errors</div>`, "#22c55e");

  return `<div style="display:flex;flex-direction:column;gap:20px">
    ${section("UPTIME", mono(uptime))}
    ${section("DISK ( / )", mono(disk))}
    ${section("MEMORY", mono(memory))}
    ${errSection}
  </div>`;
}

// Added 2026-05-09 — DL findings B3 + B5: tree + timeline shapes had no
// renderer in dispatcher and were falling through to renderCardGrid.

function renderTimeline(result: SurfaceResult): string {
  let items: Record<string, unknown>[] = [];
  for (const val of Object.values(result.data)) {
    if (Array.isArray(val) && val.length > 0) {
      items = val as Record<string, unknown>[];
      break;
    }
  }
  if (items.length === 0) {
    return "<p style='color:#aaa;font-style:italic'>No events found.</p>";
  }
  const tf = result.time_field || "occurred_at";
  const rows = items.map((it) => {
    const t = String(resolveField(it, tf) ?? "");
    const tShort = t.replace("T", " ").slice(0, 19);
    const kind = escapeHtml(String(it.event_kind ?? it.kind ?? "—"));
    const actor = escapeHtml(String(it.actor ?? ""));
    const op = escapeHtml(String(it.atomic_op ?? ""));
    const phase = escapeHtml(String(it.phase ?? ""));
    const outcome = escapeHtml(String(it.outcome ?? ""));
    const subj = escapeHtml(String(it.subject_slug ?? it.subject_node_id ?? ""));
    return `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #2a2a2a;font-size:12px">
      <span style="color:#888;font-family:monospace;font-size:11px;width:130px;flex-shrink:0">${escapeHtml(tShort)}</span>
      <span style="color:#60a5fa;font-weight:600;min-width:120px">${kind}</span>
      ${actor ? `<span style="color:#a3e635">${actor}</span>` : ""}
      ${op ? `<span style="color:#888;font-size:10px">${op}</span>` : ""}
      ${phase ? `<span style="color:#666;font-size:10px">/${phase}</span>` : ""}
      <span style="color:#aaa;flex:1;font-family:monospace;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${subj}</span>
      ${outcome ? `<span style="color:#fbbf24;font-size:10px">${outcome}</span>` : ""}
    </div>`;
  }).join("");
  return `<div style="display:flex;flex-direction:column">${rows}</div>`;
}

function renderTree(result: SurfaceResult): string {
  // Find a node array; group by scope depth + render nested
  let items: Record<string, unknown>[] = [];
  for (const val of Object.values(result.data)) {
    if (Array.isArray(val) && val.length > 0) {
      items = val as Record<string, unknown>[];
      break;
    }
  }
  if (items.length === 0) {
    // Fall back: render a substrate-scope hierarchy stub
    const root = String(result.root_scope ?? "root");
    return `<p style='color:#aaa;font-style:italic'>No nodes loaded for scope <code>${escapeHtml(root)}</code>. Surface needs walk steps to fetch nodes.</p>`;
  }
  // Build scope → items map
  const labelField = String(result.label_field || "content");
  const byScope = new Map<string, Array<Record<string, unknown>>>();
  for (const it of items) {
    const scope = String(it.scope ?? "root");
    if (!byScope.has(scope)) byScope.set(scope, []);
    byScope.get(scope)!.push(it);
  }
  const scopes = [...byScope.keys()].sort();
  const sections = scopes.map((scope) => {
    const depth = scope.split(".").length - 1;
    const indent = depth * 14;
    const groupItems = byScope.get(scope)!;
    const rows = groupItems.map((it) => {
      const slug = escapeHtml(String(it.slug ?? ""));
      const lbl = escapeHtml(String(resolveField(it, labelField) ?? it.slug ?? "—").slice(0, 80));
      const nt = escapeHtml(String(it.node_type ?? ""));
      return `<div style="padding:3px 0 3px ${indent + 14}px;font-size:12px;border-left:1px solid #2a2a2a;margin-left:${indent}px">
        <span style="color:#60a5fa;font-family:monospace;font-size:11px">${slug}</span>
        <span style="color:#666;font-size:10px;margin-left:6px">${nt}</span>
        <div style="color:#aaa;font-size:11px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${lbl}</div>
      </div>`;
    }).join("");
    return `<div>
      <div style="padding:6px 0 4px ${indent}px;font-family:monospace;font-size:11px;color:#888;font-weight:600">${escapeHtml(scope)}</div>
      ${rows}
    </div>`;
  }).join("");
  return `<div style="display:flex;flex-direction:column">${sections}</div>`;
}

function renderSurface(result: SurfaceResult): string {
  switch (result.render_shape) {
    case "kanban":           return renderKanban(result);
    case "card-grid":        return renderCardGrid(result);
    case "table":            return renderTable(result);
    case "list":             return renderList(result);
    case "dashboard":        return renderDashboard(result);
    case "activity-stream":  return renderActivityStream(result);
    case "approval-queue":   return renderApprovalQueue(result);
    case "mermaid":          return renderMermaid(result);
    case "file-browser":     return renderFileBrowser(result);
    case "cluster-state":    return renderClusterState(result);
    case "intercom-events":  return renderIntercomEvents(result);
    case "box-health":       return renderBoxHealth(result);
    case "timeline":         return renderTimeline(result);
    case "tree":             return renderTree(result);
    default:                 return renderCardGrid(result);
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

  // Mermaid render_shape — diagram lives directly in payload, no steps needed
  if (payload.render_shape === "mermaid" && typeof payload.diagram === "string") {
    const syntheticResult: SurfaceResult = {
      slug,
      title: typeof payload.title === "string" ? payload.title : slug,
      render_shape: "mermaid",
      data: { diagram: payload.diagram as string },
    };
    contentHtml = renderSurface(syntheticResult);

  // Walk-executor surface: execute steps and render by shape
  } else if (Array.isArray(payload.steps) && (payload.steps as unknown[]).length > 0) {
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
