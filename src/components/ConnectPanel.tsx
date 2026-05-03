"use client";

import { useState } from "react";
import QRCode from "react-qr-code";

const BOOT_PROMPT = `You are joining a live cntxos work session with Randy (Pacific Style Operations).

Surface: viewer.cntxos.com — two-pane substrate viewer
  Left pane: node viewer / editor (human-controlled)
  Right pane: AI-controlled — YOU drive this

Substrate: context_os (Supabase) — graph of nodes, relations, events
Navigate: viewer.cntxos.com/{node-slug}

## Driving the right pane

Post a frame-update event to control what Randy sees on the right side of his screen in real time.

POST https://viewer.cntxos.com/api/node/event
Content-Type: application/json

{
  "slug": "conv-frame-state",
  "actor": "dl",
  "event_kind": "frame-update",
  "payload": {
    "slots": [
      { "name": "main", "type": "node", "ref": "SLUG-OF-NODE-TO-SHOW" }
    ]
  }
}

Slot types:
  "node"   — renders a node's surface (most common)
  "stream" — renders a walk-formula stream
Multiple slots display as a grid.

## Your first move

1. Post a frame-update showing the node Randy is currently viewing
2. Ask Randy what they need
3. Drive the right pane to support whatever they're working on

Start with: "I'm in. What are we working on?"`;



const CLAUDE_URL = `https://claude.ai/new?q=${encodeURIComponent(BOOT_PROMPT)}`;

export function ConnectPanel() {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(BOOT_PROMPT);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-5 py-2.5 border-b border-rule/30 flex items-center gap-3">
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted">
          Connect your AI
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-6 flex flex-col gap-7">

        <p className="text-[13px] text-muted leading-relaxed max-w-md">
          Paste this prompt into Claude, ChatGPT, or any AI to sync it with
          this session — or scan the code to open Claude with the prompt
          pre-loaded.
        </p>

        {/* Boot prompt */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-dim">boot prompt</span>
            <button
              onClick={copy}
              className="text-[11px] border border-rule/40 px-2.5 py-0.5 text-muted hover:text-ink hover:border-rule/70 transition-colors"
            >
              {copied ? "copied ✓" : "copy"}
            </button>
          </div>
          <pre className="font-mono text-[11px] text-ink bg-rule/10 border border-rule/30 p-4 leading-loose whitespace-pre-wrap">
            {BOOT_PROMPT}
          </pre>
        </div>

        {/* Open in Claude */}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-widest text-dim">open in claude</span>
          <a
            href={CLAUDE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-[12px] border border-rule/40 px-3 py-1.5 text-muted hover:text-ink hover:border-rule/70 transition-colors w-fit"
          >
            claude.ai ↗
          </a>
        </div>

        {/* QR code */}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-widest text-dim">scan to open</span>
          <div className="p-3 bg-white inline-block w-fit">
            <QRCode value={CLAUDE_URL} size={156} />
          </div>
          <span className="text-[10px] text-dim">
            opens Claude with boot prompt pre-loaded
          </span>
        </div>

      </div>
    </div>
  );
}
