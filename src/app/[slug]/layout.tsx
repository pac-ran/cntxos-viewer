"use client";

// Per Randy 2026-05-09: panes are NOT attached on the front end.
// SlugLayout used to render BOTH NodeEditor (children) + WrapperPanel.
// Now it ONLY renders the editor side. WrapperPanel lives at /pane/agent
// as its own standalone route. Workspace embeds them as TWO independent
// iframes side by side. The substrate couples them logically; the UI does not.

export default function SlugLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col h-full">{children}</div>;
}
