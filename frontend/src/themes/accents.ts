// ============================================================
// BLOCK-49 加映三 — 主题色（强调色）系统。
//
// 在 light/dark（明暗维度）之上增加独立的「主题色」维度：
// 用户选择强调色（teal 默认 / 蓝 / 紫 / 玫红 / 琥珀），ThemeProvider 将
// data-accent 注入 html；custom.css 里每档 [data-accent='…'] 覆盖
// accent token（light/dark 双套），其余 token 不动。
// ============================================================

import { readCachedAccent, type AccentId } from './prefCache';

export type { AccentId };

export interface AccentOption {
  id: AccentId;
  label: string;
  /** 面板色板圆点用的 hex（light 基准）。 */
  swatch: string;
}

export const ACCENT_OPTIONS: ReadonlyArray<AccentOption & { id: AccentId }> = [
  // S5/P1-3 默认档迁至 A0 裁决的 celadon-ink（青瓷·墨）；teal 退为遗留基础档
  // （token 在 :root，applyAccent 对 teal 移除属性即回落基础身份）。
  { id: 'teal', label: '青碧', swatch: '#0d9488' },
  { id: 'blue', label: '远蓝', swatch: '#2563eb' },
  { id: 'violet', label: '紫罗兰', swatch: '#7c3aed' },
  { id: 'rose', label: '玫红', swatch: '#e11d48' },
  { id: 'amber', label: '琥珀', swatch: '#d97706' },
  // V5 身份面上线 — 四套和声（东方视觉语境；复用同一 [data-accent] 管道）。
  { id: 'paper-vermilion', label: '宣纸·朱砂', swatch: '#b5482f' },
  { id: 'celadon-ink', label: '青瓷·墨（默认）', swatch: '#0f766e' },
  { id: 'ultramarine-brass', label: '群青·铜', swatch: '#a87c42' },
  { id: 'indigo-mist', label: '靛·雾', swatch: '#6e9ca0' },
];

// BLOCK-203 W4a P7 — 缓存键、枚举与读取全部迁到 `prefCache`（真值在服务端 user-prefs.json）；
// 本文件只保留"当前实现认哪个 id"的选项表与 DOM 应用逻辑。
export function readAccent(): AccentId {
  return readCachedAccent();
}

/** B 方案（用户裁决）：and声档联切骨架维度；前 5 档维持默认海军蓝骨架（返回 null）。 */
export type SurfaceId = 'paper' | 'celadon' | 'ultramarine' | 'mist';

export function surfaceForAccent(accent: AccentId): SurfaceId | null {
  switch (accent) {
    case 'paper-vermilion': return 'paper';
    case 'celadon-ink': return 'celadon';
    case 'ultramarine-brass': return 'ultramarine';
    case 'indigo-mist': return 'mist';
    default: return null;
  }
}

export function applyAccent(accent: AccentId): void {
  const html = document.documentElement;
  if (accent === 'teal') html.removeAttribute('data-accent');
  else html.setAttribute('data-accent', accent);
  // 骨架随档联切（正交 CSS 维度；不新增持久化偏好，避免第二真相源）。
  const surface = surfaceForAccent(accent);
  if (surface) html.setAttribute('data-surface', surface);
  else html.removeAttribute('data-surface');
}

