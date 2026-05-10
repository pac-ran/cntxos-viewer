"use client";

// AdminRail — WordPress-style vertical navigation rail on the FAR LEFT edge of
// the LEFT pane. Collapsed (icon only) ~56px; expands on hover or pin.
// Submenu pops out to the RIGHT on hover, overlaying content.
//
// Per Randy 2026-05-09: cntx orange background, tight icon spacing, pin/unpin
// toggle at top persisted via localStorage["admin-rail-pinned"].

import { useState, useCallback, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";

interface MenuItem {
  key: string;
  label: string;
  icon: string;
  slug: string;
  submenu: { label: string; slug: string }[];
}

const MENU: MenuItem[] = [
  {
    key: "files",
    label: "Files",
    icon: "📁",
    slug: "s-files-index",
    submenu: [
      { label: "All files", slug: "s-files-index" },
      { label: "Recent uploads", slug: "s-files-recent" },
      { label: "By type", slug: "s-files-by-type" },
      { label: "Trash", slug: "s-files-trash" },
    ],
  },
  {
    key: "links",
    label: "Links",
    icon: "🔗",
    slug: "s-links-index",
    submenu: [
      { label: "All links", slug: "s-links-index" },
      { label: "By tag", slug: "s-links-by-tag" },
      { label: "By target", slug: "s-links-by-target" },
    ],
  },
  {
    key: "connections",
    label: "Connections",
    icon: "🔌",
    slug: "s-connections-index",
    submenu: [
      { label: "Etsy", slug: "s-connections-etsy" },
      { label: "OAuth providers", slug: "s-connections-oauth" },
      { label: "API keys", slug: "s-connections-api-keys" },
      { label: "Webhooks", slug: "s-connections-webhooks" },
    ],
  },
  {
    key: "projects",
    label: "Projects",
    icon: "📋",
    slug: "s-projects-index",
    submenu: [
      { label: "All projects", slug: "s-projects-index" },
      { label: "Active", slug: "s-projects-active" },
      { label: "Archived", slug: "s-projects-archived" },
    ],
  },
  {
    key: "crm",
    label: "CRM",
    icon: "👥",
    slug: "s-crm-index",
    submenu: [
      { label: "Contacts", slug: "s-crm-contacts" },
      { label: "Companies", slug: "s-crm-companies" },
      { label: "Activities", slug: "s-crm-activities" },
    ],
  },
  {
    key: "listings",
    label: "Listings",
    icon: "🏷️",
    slug: "s-listings-index",
    submenu: [
      { label: "All listings", slug: "s-listings-index" },
      { label: "By marketplace", slug: "s-listings-by-marketplace" },
      { label: "Drafts", slug: "s-listings-drafts" },
      { label: "Active", slug: "s-listings-active" },
    ],
  },
];

// 2026-05-10 v2 design pass (Randy): cream everywhere, orange accent only.
// Rail is cream with orange-foreground icons; orange right-edge separator.
// Active state = filled orange (icon flips to cream) so the pivot still reads.
const RAIL_BG = "#F5F2E8";       // cream (matches CONTENT_BG)
const RAIL_FG = "#C2400C";       // orange foreground (icons + labels)
const RAIL_INK = "#1A1A1A";      // dark text for hovered labels (readability)
const RAIL_ACTIVE_BG = "#C2400C"; // orange — active item filled
const RAIL_ACTIVE_FG = "#F5F2E8"; // cream — active item icon/text
const RAIL_HOVER = "rgba(194,64,12,0.08)"; // soft orange tint
const RAIL_BORDER = "#C2400C";   // orange right-edge separator
const PIN_KEY = "admin-rail-pinned";

interface Props {
  currentSlug: string;
  actor: string;
}

export function AdminRail({ currentSlug, actor }: Props) {
  const router = useRouter();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  // Load pin state from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(PIN_KEY);
      if (stored === "1") setPinned(true);
    } catch {/* ignore */}
  }, []);

  const togglePin = useCallback(() => {
    setPinned(prev => {
      const next = !prev;
      try { localStorage.setItem(PIN_KEY, next ? "1" : "0"); } catch {/* ignore */}
      return next;
    });
  }, []);

  const expanded = pinned || hovered;

  const activeKey = useMemo(() => {
    for (const item of MENU) {
      if (item.slug === currentSlug) return item.key;
      if (item.submenu.some(s => s.slug === currentSlug)) return item.key;
    }
    return null;
  }, [currentSlug]);

  const navigate = useCallback((slug: string) => {
    setHoverKey(null);
    const sp = new URLSearchParams();
    if (actor) sp.set("actor", actor);
    const qs = sp.toString();
    router.push(`/${slug}${qs ? `?${qs}` : ""}`);
  }, [router, actor]);

  const railWidth = expanded ? 200 : 56;

  return (
    <div
      className="relative shrink-0 h-full flex flex-col"
      style={{
        width: railWidth,
        background: RAIL_BG,
        color: RAIL_FG,
        borderRight: `1px solid ${RAIL_BORDER}`,
        transition: "width 120ms ease",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setHoverKey(null); }}
      aria-label="Admin navigation"
    >
      {/* Pin/unpin toggle */}
      <button
        onClick={togglePin}
        className="shrink-0 w-full h-10 flex items-center gap-2 px-4 border-b transition-colors"
        style={{
          borderColor: "rgba(194,64,12,0.20)",
          color: RAIL_FG,
          background: pinned ? RAIL_HOVER : "transparent",
        }}
        title={pinned ? "unpin (collapse on mouse-out)" : "pin (keep expanded)"}
        aria-pressed={pinned}
      >
        <span className="text-[16px] shrink-0 w-6 text-center" aria-hidden>
          {pinned ? "📌" : "📍"}
        </span>
        {expanded && (
          <span className="text-[11px] font-semibold uppercase tracking-wide truncate">
            {pinned ? "pinned" : "pin"}
          </span>
        )}
      </button>

      <nav className="flex-1 flex flex-col py-1">
        {MENU.map(item => {
          const isActive = activeKey === item.key;
          const isHover = hoverKey === item.key;
          return (
            <div
              key={item.key}
              className="relative"
              onMouseEnter={() => setHoverKey(item.key)}
            >
              <button
                onClick={() => navigate(item.slug)}
                className="w-full h-10 flex items-center gap-3 px-4 text-left transition-colors"
                style={{
                  color: isActive ? RAIL_ACTIVE_FG : RAIL_FG,
                  background: isActive
                    ? RAIL_ACTIVE_BG
                    : isHover
                      ? RAIL_HOVER
                      : "transparent",
                  borderLeft: isActive ? `3px solid ${RAIL_ACTIVE_BG}` : "3px solid transparent",
                }}
                title={item.label}
              >
                <span className="text-[18px] shrink-0 w-6 text-center" aria-hidden>
                  {item.icon}
                </span>
                {expanded && (
                  <span
                    className="text-[12px] font-semibold tracking-wide truncate"
                    style={{ color: isActive ? RAIL_ACTIVE_FG : RAIL_INK }}
                  >
                    {item.label}
                  </span>
                )}
              </button>

              {/* Submenu — pops out to the RIGHT, overlays content. Cream
                  surface with orange border + orange-foreground items. */}
              {isHover && (
                <div
                  className="absolute top-0 left-full z-50 min-w-[200px] flex flex-col py-1 shadow-2xl"
                  style={{
                    background: RAIL_BG,
                    color: RAIL_FG,
                    border: `1px solid ${RAIL_BORDER}`,
                  }}
                  onMouseEnter={() => setHoverKey(item.key)}
                  onMouseLeave={() => setHoverKey(null)}
                >
                  <div
                    className="px-3 py-1.5 text-[11px] uppercase tracking-widest"
                    style={{ color: RAIL_FG, opacity: 0.85 }}
                  >
                    {item.label}
                  </div>
                  {item.submenu.map(sub => {
                    const isSubActive = sub.slug === currentSlug;
                    return (
                      <button
                        key={sub.slug}
                        onClick={() => navigate(sub.slug)}
                        className="text-left px-4 py-1.5 text-[12px] transition-colors"
                        style={{
                          color: isSubActive ? RAIL_ACTIVE_FG : RAIL_INK,
                          background: isSubActive ? RAIL_ACTIVE_BG : "transparent",
                          fontWeight: isSubActive ? 600 : 400,
                        }}
                        onMouseEnter={(e) => {
                          if (!isSubActive) (e.currentTarget as HTMLButtonElement).style.background = RAIL_HOVER;
                        }}
                        onMouseLeave={(e) => {
                          if (!isSubActive) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                        }}
                      >
                        {sub.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );
}
