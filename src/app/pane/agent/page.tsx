// Per Randy 2026-05-09: agent (right) pane is its own standalone route.
// Embedded by workspace as a separate iframe; not coupled to the editor pane.

import { WrapperPanel } from "@/components/WrapperPanel";

export const dynamic = "force-dynamic";

export default function AgentPanePage() {
  return (
    <div className="flex flex-col h-screen">
      <WrapperPanel />
    </div>
  );
}
