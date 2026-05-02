"use client";

import { useState } from "react";
import { WrapperPanel } from "@/components/WrapperPanel";
import { NodeEditor } from "@/components/NodeEditor";
import { NodeViewer } from "@/components/NodeViewer";
import { use } from "react";

interface Props {
  params: Promise<{ slug: string }>;
}

export default function NodePage({ params }: Props) {
  const { slug } = use(params);
  const [mode, setMode] = useState<"view" | "edit">("view");

  return (
    <div className="flex h-full">
      {/* Left pane — 40% */}
      <div className="relative w-[40%] h-full border-r border-rule/30 flex flex-col overflow-hidden">
        <div className="shrink-0 px-5 py-2 border-b border-rule/30 flex items-center gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted/60">
            {mode === "view" ? "Node" : "Edit"}
          </span>
          {mode === "edit" && (
            <button
              onClick={() => setMode("view")}
              className="ml-auto text-[11px] border border-rule/40 px-2.5 py-0.5 text-muted hover:text-ink hover:border-rule/70 transition-colors"
            >
              ← view
            </button>
          )}
        </div>
        {mode === "view"
          ? <NodeViewer slug={slug} onEdit={() => setMode("edit")} />
          : <NodeEditor slug={slug} />
        }
      </div>

      {/* Right pane — 60% — AI viewer */}
      <div className="w-[60%] h-full">
        <WrapperPanel />
      </div>
    </div>
  );
}
