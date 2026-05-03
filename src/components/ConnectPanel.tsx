"use client";

import { useState } from "react";
import QRCode from "react-qr-code";

const BOOT_PROMPT = `You are joining a live cntxos work session with Randy (Pacific Style Operations).

Surface: viewer.cntxos.com — two-pane substrate viewer
  Left pane: Randy controls (node viewer / editor)
  Right pane: YOU control — drive it when Randy asks

## Your first move — do this now

Say: "I'm in. What do you need?"

Then stop. Wait for Randy to tell you what to show or do.
Do not poll. Do not try to figure out what Randy is viewing.
Do not test anything on your own. Randy will direct you.

## How to drive the right pane (when Randy asks)

POST https://viewer.cntxos.com/api/node/event
Content-Type: application/json

{
  "slug": "conv-frame-state",
  "actor": "dl",
  "event_kind": "frame-update",
  "payload": {
    "slots": [
      { "name": "main", "type": "node", "ref": "NODE-SLUG-HERE" }
    ]
  }
}

Slot types: "node" (most common), "stream" (walk formula), "surface"
Multiple slots render as a grid.`;

const QUICK_REF = `Drive the right pane — paste this, fill in the slug:

curl -X POST https://viewer.cntxos.com/api/node/event \\
  -H "Content-Type: application/json" \\
  -d '{
    "slug": "conv-frame-state",
    "actor": "dl",
    "event_kind": "frame-update",
    "payload": {
      "slots": [{ "name": "main", "type": "node", "ref": "NODE-SLUG-HERE" }]
    }
  }'

Replace NODE-SLUG-HERE with any node slug (e.g. m-box-render-build).
Multiple slots = grid: add more objects to the "slots" array.`;

const CLAUDE_URL = `https://claude.ai/new?q=${encodeURIComponent(BOOT_PROMPT)}`;

export function ConnectPanel() {
  const [bootCopied, setBootCopied] = useState(false);
  const [refCopied, setRefCopied] = useState(false);

  const copyBoot = () => {
    navigator.clipboard.writeText(BOOT_PROMPT);
    setBootCopied(true);
    setTimeout(() => setBootCopied(false), 2000);
  };

  const copyRef = () => {
    navigator.clipboard.writeText(QUICK_REF);
    setRefCopied(true);
    setTimeout(() => setRefCopied(false), 2000);
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

        {/* Boot prompt */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-dim">boot prompt — paste to start a session</span>
            <button
              onClick={copyBoot}
              className="text-[11px] border border-rule/40 px-2.5 py-0.5 text-muted hover:text-ink hover:border-rule/70 transition-colors shrink-0"
            >
              {bootCopied ? "copied ✓" : "copy"}
            </button>
          </div>
          <pre className="font-mono text-[11px] text-ink bg-rule/10 border border-rule/30 p-4 leading-loose whitespace-pre-wrap">
            {BOOT_PROMPT}
          </pre>
        </div>

        {/* Quick reference — paste mid-conversation */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-dim">quick ref — paste this if they get lost</span>
            <button
              onClick={copyRef}
              className="text-[11px] border border-accent/50 px-2.5 py-0.5 text-accent hover:bg-accent hover:text-bg transition-colors shrink-0"
            >
              {refCopied ? "copied ✓" : "copy"}
            </button>
          </div>
          <pre className="font-mono text-[11px] text-ink bg-rule/10 border border-rule/30 p-4 leading-loose whitespace-pre-wrap">
            {QUICK_REF}
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
