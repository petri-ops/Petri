/**
 * src/main/gen-ui/theme.js
 *
 * BLOCK-166 [C 层] 沙箱页主题（规格 §7 + plan §4-主题行 / §6-坑 15）：
 * - THEME_VAR_MAP：petri token → gen-ui 标准变量 的字面值映射层。每个值逐条
 *   取自 token 单源（frontend/src/styles/custom.css 的 :root 亮色 /
 *   html[data-theme='dark'] 暗色块、[data-accent] 派生档）；漂移由
 *   test/gen-ui-theme-tokens.test.mjs 机械守护，token 改值必须同步本表。
 * - buildGenUiThemeCss()：注入沙箱页的值层 CSS。light-dark() 对随 guest 桥
 *   设置的 color-scheme 翻转（Chromium 123+，本仓 Electron 41）；壳内注入
 *   顺序固定为 visualize.css（契约层/工具类）→ 本层（值层覆盖）。
 * - 派生变量（--muted、--viz-series-1..6、--font-size-base）在 CSS 层用已映射
 *   变量派生，不引入第三处色值。
 * - 主题色 accent 五档中 P1 只映射默认 teal 主变量；--purple/--yellow 取
 *   violet/amber accent 档值充任图表分类色。accent 全档注入=P2+ 候选。
 */

const fs = require('fs');
const path = require('path');

const THEME_VAR_MAP = {
  '--background': { source: '--petri-bg-canvas', light: '#ffffff', dark: '#0b1220' },
  '--foreground': { source: '--petri-text', light: '#18181b', dark: '#e6edf3' },
  '--card': { source: '--petri-bg-surface', light: '#ffffff', dark: '#111a2e' },
  '--card-foreground': { source: '--petri-text', light: '#18181b', dark: '#e6edf3' },
  '--popover': { source: '--petri-bg-elevated', light: '#ffffff', dark: '#1d2945' },
  '--popover-foreground': { source: '--petri-text', light: '#18181b', dark: '#e6edf3' },
  '--primary': { source: '--petri-accent', light: '#0d9488', dark: '#2dd4bf' },
  '--primary-foreground': { source: '--petri-on-accent', light: '#ffffff', dark: '#ffffff' },
  '--secondary': { source: '--petri-bg-subtle', light: '#f4f4f5', dark: '#182339' },
  '--secondary-foreground': { source: '--petri-text', light: '#18181b', dark: '#e6edf3' },
  '--muted-foreground': { source: '--petri-text-secondary', light: '#3f3f46', dark: '#b1bac4' },
  '--accent': { source: '--petri-accent-bg', light: '#f0fdfa', dark: 'rgba(45, 212, 191, 0.14)' },
  '--accent-foreground': { source: '--petri-text', light: '#18181b', dark: '#e6edf3' },
  '--destructive': { source: '--petri-danger', light: '#ef4444', dark: '#f87171' },
  '--border': { source: '--petri-border', light: '#e4e4e7', dark: '#243149' },
  '--input': { source: '--petri-border-strong', light: '#d4d4d8', dark: '#324466' },
  '--ring': { source: '--petri-accent', light: '#0d9488', dark: '#2dd4bf' },
  '--blue': { source: '--petri-status-info', light: '#3b82f6', dark: '#60a5fa' },
  '--orange': { source: '--petri-status-warning', light: '#f97316', dark: '#fb923c' },
  '--green': { source: '--petri-status-online', light: '#22c55e', dark: '#4ade80' },
  '--red': { source: '--petri-status-error', light: '#ef4444', dark: '#f87171' },
  // 图表分类色补充：violet/amber accent 档值（custom.css [data-accent] 块）
  '--purple': { source: 'accent:violet', light: '#7c3aed', dark: '#a78bfa' },
  '--yellow': { source: 'accent:amber', light: '#d97706', dark: '#fbbf24' },
};

let _visualizeCssCache = null;

/** visualize.css（契约层/工具类，随包静态资产），壳内先于主题值层注入。 */
function loadVisualizeCss() {
  if (_visualizeCssCache === null) {
    const file = path.join(__dirname, '..', '..', '..', 'resources', 'gen-ui', 'visualize.css');
    _visualizeCssCache = fs.readFileSync(file, 'utf8');
  }
  return _visualizeCssCache;
}

function buildGenUiThemeCss() {
  const lines = [':root{color-scheme:light dark;'];
  for (const [name, entry] of Object.entries(THEME_VAR_MAP)) {
    lines.push(`${name}:light-dark(${entry.light},${entry.dark});`);
  }
  // 派生层：不引入第三处色值
  lines.push('--muted:color-mix(in srgb,var(--foreground) 10%,transparent);');
  lines.push('--viz-series-1:var(--primary);');
  lines.push('--viz-series-2:var(--orange);');
  lines.push('--viz-series-3:var(--green);');
  lines.push('--viz-series-4:var(--purple);');
  lines.push('--viz-series-5:var(--blue);');
  lines.push('--viz-series-6:var(--yellow);');
  lines.push('--font-size-base:14px;');
  lines.push('}');
  lines.push('html>body{margin:0;background:var(--background);color:var(--foreground);');
  lines.push('font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:var(--font-size-base);}');
  return lines.join('');
}

module.exports = { THEME_VAR_MAP, buildGenUiThemeCss, loadVisualizeCss };
