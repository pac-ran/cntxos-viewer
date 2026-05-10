// Per Randy 2026-05-09: agent (right) pane is its own standalone route.
// Embedded by workspace as a separate iframe; not coupled to the editor pane.
//
// 2026-05-10 design pass: three-layer contrast.
//   UR (content, primary): WrapperPanel on cream #F5F2E8.
//   LR (chat, recessed):   ChatPane on #EEEAE0 with 1px top rule.

import { WrapperPanel } from "@/components/WrapperPanel";
import { ChatPane } from "@/components/ChatPane";

export const dynamic = "force-dynamic";

const CONTENT_BG = "#F5F2E8";
const RULE = "#B8B09C";

export default function AgentPanePage() {
  return (
    <div className="flex flex-col h-screen" style={{ background: CONTENT_BG }}>
      <div
        className="flex-[3] min-h-0 overflow-hidden"
        style={{ background: CONTENT_BG }}
      >
        <WrapperPanel />
      </div>
      <div
        className="flex-[2] min-h-0 overflow-hidden border-t"
        style={{ borderColor: `${RULE}80` }}
      >
        <ChatPane />
      </div>
    </div>
  );
}
