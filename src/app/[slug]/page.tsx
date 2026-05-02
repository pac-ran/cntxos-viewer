import { WrapperPanel } from "@/components/WrapperPanel";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function NodePage({ params }: Props) {
  const { slug } = await params;

  return (
    <div className="flex h-full">
      {/* Left pane — 40% — node editor */}
      <div className="w-[40%] h-full border-r border-rule/30 flex flex-col">
        <div className="shrink-0 px-5 py-2.5 border-b border-rule/30">
          <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted">Node Editor</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <span className="font-mono text-[11px] text-muted font-mono">{slug}</span>
        </div>
      </div>

      {/* Right pane — 60% — AI viewer */}
      <div className="w-[60%] h-full">
        <WrapperPanel />
      </div>
    </div>
  );
}
