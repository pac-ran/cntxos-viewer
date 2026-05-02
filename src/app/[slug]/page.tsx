import { WrapperPanel } from "@/components/WrapperPanel";
import { NodeEditor } from "@/components/NodeEditor";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function NodePage({ params }: Props) {
  const { slug } = await params;

  return (
    <div className="flex h-full">
      {/* Left pane — 40% — node editor */}
      <div className="relative w-[40%] h-full border-r border-rule/30 flex flex-col overflow-hidden">
        <div className="shrink-0 px-5 py-2 border-b border-rule/30">
          <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted/60">Node Editor</span>
        </div>
        <NodeEditor slug={slug} />
      </div>

      {/* Right pane — 60% — AI viewer */}
      <div className="w-[60%] h-full">
        <WrapperPanel />
      </div>
    </div>
  );
}
