// Landing page bypassed per Randy direction 2026-05-09:
// On / we now skip the Watch / Edit / Add-contact gate and land directly in
// the 2-pane workspace with the per-user boot prompt loaded on the left.
//
// AI driving the right pane (frame-update events on conv-frame-state-{actor})
// happens transparently — same machinery as /[slug] pages.

import { redirect } from "next/navigation";

const DEFAULT_NODE_BY_ACTOR: Record<string, string> = {
  randy: "n-boot-prompt-randy",
  nancy: "n-boot-prompt-nancy",
};
const FALLBACK_NODE = "n-boot-prompt-randy";

interface PageProps {
  searchParams: Promise<{ actor?: string }>;
}

export default async function LandingRedirect({ searchParams }: PageProps) {
  const { actor } = await searchParams;
  const slug = (actor && DEFAULT_NODE_BY_ACTOR[actor]) || FALLBACK_NODE;
  const qs = actor ? `?actor=${encodeURIComponent(actor)}` : "";
  redirect(`/${slug}${qs}`);
}
