"use client";

import { WrapperPanel } from "@/components/WrapperPanel";

export default function ContactIngressLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full">
      <div className="w-[40%] h-full border-r border-rule/30 flex flex-col overflow-hidden">
        {children}
      </div>
      <div className="w-[60%] h-full">
        <WrapperPanel />
      </div>
    </div>
  );
}
