// ============================================================
// Icon — minimal inline-SVG icon component
//
// Self-contained. Pulls only what we need. Lucide-style outline
// (24x24, stroke 1.75, round caps + joins, currentColor).
//
// Add a new icon by extending the `paths` map below — only declare
// what's actually rendered in UI chrome (NOT in chat content / FigCode
// slogans, those stay as authored).
//
// Usage:
//   <Icon name="book" />
//   <Icon name="graduation-cap" size={18} />
//   <Icon name="dna" className="biof3-icon--accent" />
// ============================================================

import React from 'react';

export type IconName =
  | 'search'
  | 'user'
  | 'book'
  | 'book-marked'
  | 'graduation-cap'
  | 'dna'
  | 'shield'
  | 'log-out'
  | 'bar-chart'
  | 'calendar'
  | 'repeat'
  | 'printer'
  | 'brain'
  | 'study'
  | 'sparkles'
  | 'arrow-right'
  | 'arrow-up'
  | 'check'
  | 'refresh'
  | 'flag'
  | 'pin'
  | 'archive'
  | 'sidebar'
  | 'image'
  | 'settings'
  | 'puzzle'
  | 'x'
  | 'download'
  | 'trash'
  | 'key'
  | 'cpu'
  | 'sun'
  | 'moon'
  | 'zap'
  | 'clock'
  | 'folder'
  | 'file'
  | 'database'
  | 'globe'
  | 'terminal'
  | 'arrow-left'
  | 'panel-left'
  | 'panel-right'
  | 'panel-bottom'
  | 'chevron-down'
  | 'chevron-up'
  | 'chevron-right'
  | 'wrench'
  | 'layout-grid'
  | 'list-details'
  | 'plus'
  | 'message-circle'
  | 'send'
  | 'square'
  | 'minus'
  | 'more-horizontal';

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  /** Optional aria-label. If omitted, the icon is decorative (aria-hidden). */
  label?: string;
  strokeWidth?: number;
}

// All paths share: 24×24 viewBox, fill=none, stroke=currentColor.
// Each entry returns the inner SVG (without the <svg> wrapper).
const paths: Record<IconName, React.ReactNode> = {
  // Search — magnifying glass
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>
  ),
  // User — person avatar
  user: (
    <>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  // BookOpen — learning records
  book: (
    <>
      <path d="M2 4h7a3 3 0 0 1 3 3v13" />
      <path d="M22 4h-7a3 3 0 0 0-3 3v13" />
      <path d="M2 4v15h7a3 3 0 0 1 3 3" />
      <path d="M22 4v15h-7a3 3 0 0 0-3 3" />
    </>
  ),
  // BookMarked — "这张图属于哪节课"
  'book-marked': (
    <>
      <path d="M19 21V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v16l4-3 4 3 4-3 2 1Z" />
      <path d="M10 3v8l2-1.5L14 11V3" />
    </>
  ),
  // GraduationCap — 组学实践
  'graduation-cap': (
    <>
      <path d="M22 10v6" />
      <path d="m2 10 10-5 10 5-10 5-10-5Z" />
      <path d="M6 12v5c3 2 9 2 12 0v-5" />
    </>
  ),
  // DNA — single-cell platform
  dna: (
    <>
      <path d="M4 3v1a8 8 0 0 0 16 0V3" />
      <path d="M4 21v-1a8 8 0 0 1 16 0v1" />
      <path d="M7 6h10" />
      <path d="M7 18h10" />
      <path d="M9 9h6" />
      <path d="M9 15h6" />
    </>
  ),
  // Shield — admin / governance
  shield: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
    </>
  ),
  // LogOut
  'log-out': (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </>
  ),
  // BarChart3 — 各领域分布
  'bar-chart': (
    <>
      <path d="M3 3v18h18" />
      <path d="M7 16v-5" />
      <path d="M12 16V7" />
      <path d="M17 16v-3" />
    </>
  ),
  // Calendar — 时间线
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </>
  ),
  // Repeat / RefreshCw — 复习
  repeat: (
    <>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </>
  ),
  // Printer
  printer: (
    <>
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </>
  ),
  // Brain
  brain: (
    <>
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04Z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04Z" />
    </>
  ),
  // Study (a generic notebook + pen)
  study: (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
      <path d="M9 6h6" />
      <path d="M9 10h6" />
    </>
  ),
  // Sparkles — AI vibe
  sparkles: (
    <>
      <path d="m12 3 1.9 4.6L18.5 9l-4.6 1.9L12 15l-1.9-4.1L5.5 9l4.6-1.4L12 3Z" />
      <path d="M5 19l.7 1.6L7.5 21l-1.8.4L5 23l-.7-1.6L2.5 21l1.8-.4L5 19Z" />
      <path d="M19 14l.7 1.6L21.5 16l-1.8.4L19 18l-.7-1.6L16.5 16l1.8-.4L19 14Z" />
    </>
  ),
  // ArrowRight
  'arrow-right': (
    <>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </>
  ),
  // ArrowUp — submit / send
  'arrow-up': (
    <>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </>
  ),
  check: <polyline points="20 6 9 17 4 12" />,
  refresh: (
    <>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <polyline points="21 3 21 8 16 8" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <polyline points="3 21 3 16 8 16" />
    </>
  ),
  // Flag — milestone / start
  flag: (
    <>
      <path d="M4 22V4" />
      <path d="M4 4h13l-2 4 2 4H4" />
    </>
  ),
  pin: (
    <>
      <line x1="12" y1="17" x2="12" y2="22" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1V4H8v2h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
    </>
  ),
  // Archive — 长期记忆 / 事实档案（Lucide archive）
  archive: (
    <>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <path d="M10 12h4" />
    </>
  ),
  // Sidebar (right) — dock the copilot panel as a side column
  sidebar: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </>
  ),
  // Image — attach picture (Lucide image)
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
    </>
  ),
  // Settings — gear (Lucide settings, mechanical look)
  settings: (
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  // Puzzle — plugin / extension (Lucide puzzle)
  puzzle: (
    <>
      <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.878.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02z" />
    </>
  ),
  // X — close (Lucide x)
  x: (
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>
  ),
  // Download (Lucide download)
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </>
  ),
  // Trash (Lucide trash-2)
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </>
  ),
  // Key (Lucide key)
  key: (
    <>
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 3 3L22 7l-3-3" />
    </>
  ),
  // CPU — runtime / engine (Lucide cpu)
  cpu: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <line x1="9" y1="1" x2="9" y2="4" />
      <line x1="15" y1="1" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="23" />
      <line x1="15" y1="20" x2="15" y2="23" />
      <line x1="20" y1="9" x2="23" y2="9" />
      <line x1="20" y1="14" x2="23" y2="14" />
      <line x1="1" y1="9" x2="4" y2="9" />
      <line x1="1" y1="14" x2="4" y2="14" />
    </>
  ),
  // Sun — light mode (Lucide sun)
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
      <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
      <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
    </>
  ),
  // Moon — dark mode (Lucide moon)
  moon: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />,
  // Zap — quick start / lightning (Lucide zap)
  zap: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
  // Clock — recent runs (Lucide clock)
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </>
  ),
  // Folder — project / resource (Lucide folder)
  folder: <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />,
  // File — generic file (Lucide file)
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </>
  ),
  // Database — dataset / storage (Lucide database)
  database: (
    <>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </>
  ),
  // Globe — browser / web surface
  globe: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2c3.5 3.5 3.5 16.5 0 20" />
      <path d="M12 2c-3.5 3.5-3.5 16.5 0 20" />
    </>
  ),
  // Terminal — agent / console (Lucide terminal)
  terminal: (
    <>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </>
  ),
  // Arrow left — back navigation (Lucide arrow-left)
  'arrow-left': (
    <>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </>
  ),
  // Panel left — toggle left sidebar (Lucide panel-left)
  'panel-left': (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </>
  ),
  // Panel right — toggle right sidebar (Lucide panel-right)
  'panel-right': (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </>
  ),
  // Panel bottom — toggle embedded terminal
  'panel-bottom': (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="15" x2="21" y2="15" />
    </>
  ),
  // Chevron down — collapse (Lucide chevron-down)
  'chevron-down': <polyline points="6 9 12 15 18 9" />,
  'chevron-up': <polyline points="18 15 12 9 6 15" />,
  // Chevron right — expand (Lucide chevron-right)
  'chevron-right': <polyline points="9 18 15 12 9 6" />,
  // Wrench — tool / toolbox (Lucide wrench)
  wrench: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  ),
  // Layout grid — toolbox grid (Lucide layout-grid)
  'layout-grid': (
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </>
  ),
  // List details — Codex-style session summary
  'list-details': (
    <>
      <circle cx="6" cy="6" r="2.25" />
      <circle cx="6" cy="12" r="2.25" />
      <circle cx="6" cy="18" r="2.25" />
      <line x1="11" y1="6" x2="20" y2="6" />
      <line x1="11" y1="12" x2="20" y2="12" />
      <line x1="11" y1="18" x2="20" y2="18" />
    </>
  ),
  // Plus — new item (Lucide plus)
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  // Message circle — conversation (Lucide message-circle)
  'message-circle': (
    <>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </>
  ),
  // Send — send message (Lucide send)
  send: (
    <>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </>
  ),
  // Square — stop (Lucide square)
  square: (
    <rect x="3" y="3" width="18" height="18" rx="2" />
  ),
  minus: <line x1="5" y1="12" x2="19" y2="12" />,
  'more-horizontal': (
    <>
      <circle cx="6" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="18" cy="12" r="1.75" />
    </>
  ),
};

export function Icon({
  name,
  size = 16,
  className,
  label,
  strokeWidth = 1.75,
}: IconProps): React.ReactElement {
  const isDecorative = !label;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={isDecorative ? undefined : 'img'}
      aria-hidden={isDecorative ? true : undefined}
      aria-label={label}
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}

export default Icon;
