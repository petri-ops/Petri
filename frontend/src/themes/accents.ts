// ============================================================
// BLOCK-49 加映三 — 主题色（强调色）系统。
//
// 在 light/dark（明暗维度）之上增加独立的「主题色」维度：
// 用户选择强调色（teal 默认 / 蓝 / 紫 / 玫红 / 琥珀），ThemeProvider 将
// data-accent 注入 html；custom.css 里每档 [data-accent='…'] 覆盖
// accent token（light/dark 双套），其余 token 不动。
// ============================================================

export type AccentId = 'teal' | 'blue' | 'violet' | 'rose' | 'amber';

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

export const ACCENT_STORAGE_KEY = 'petri-accent';
const VALID_IDS = new Set(ACCENT_OPTIONS.map((o) => o.id as string));

export function readAccent(): AccentId {
  try {
    const saved = localStorage.getItem(ACCENT_STORAGE_KEY);
    if (saved && VALID_IDS.has(saved)) return saved as AccentId;
  } catch { /* storage unavailable */ }
  return 'teal';
}

export function applyAccent(accent: AccentId): void {
  const html = document.documentElement;
  if (accent === 'teal') html.removeAttribute('data-accent');
  else html.setAttribute('data-accent', accent);
}

