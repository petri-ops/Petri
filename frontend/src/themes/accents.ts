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
  { id: 'teal', label: '青碧（默认）', swatch: '#0d9488' },
  { id: 'blue', label: '远蓝', swatch: '#2563eb' },
  { id: 'violet', label: '紫罗兰', swatch: '#7c3aed' },
  { id: 'rose', label: '玫红', swatch: '#e11d48' },
  { id: 'amber', label: '琥珀', swatch: '#d97706' },
];

// BLOCK-203 W4a P7 — 缓存键、枚举与读取全部迁到 `prefCache`（真值在服务端 user-prefs.json）；
// 本文件只保留"当前实现认哪个 id"的选项表与 DOM 应用逻辑。
export function readAccent(): AccentId {
  return readCachedAccent();
}

export function applyAccent(accent: AccentId): void {
  const html = document.documentElement;
  if (accent === 'teal') html.removeAttribute('data-accent');
  else html.setAttribute('data-accent', accent);
}

