const fs = require('fs');
const path = require('path');

const REPORT_THEME_STYLE_ID = 'biof3-report-theme';

function normalizeReportTheme(value) {
  return value === 'light' || value === 'dark' ? value : null;
}

function isHtmlFile(filename) {
  return /\.html?$/i.test(String(filename || ''));
}

function reportThemeCss(theme) {
  if (theme === 'dark') {
    return `
:root { color-scheme: dark; --text: #e6edf7; --muted: #a5b4c8; --border: #334155; --surface: #172033; --primary: #5eead4; --code-bg: #111827; --warn: #fbbf24; --info: #60a5fa; }
html, body { background: #0b1120 !important; color: var(--text) !important; }
a { color: #5eead4; }
nav, .nav-wrap, .nav-toggle, .wechat-float { background: #111a2e !important; color: var(--text) !important; border-color: var(--border) !important; }
th, td, table, pre, code, .stat-card { border-color: var(--border) !important; }
th, pre, code, .stat-card { background: var(--surface) !important; }
.callout, .callout-info, .callout-warn, .callout-tip { background: #172033 !important; color: var(--text) !important; }
.nav-wrap .nav-title { color: var(--primary) !important; }
.nav-wrap a { color: var(--muted) !important; }
.nav-wrap a:hover { color: var(--primary) !important; }
.wechat-float .info { color: var(--muted) !important; }
.wechat-float .info strong { color: var(--text) !important; }
img { background: transparent; }
`;
  }
  return `
:root { color-scheme: light; --text: #17201d; --muted: #5c6b64; --border: #dfe8e3; --surface: #f8faf9; --primary: #2e8555; --code-bg: #f4f7f5; --warn: #d97706; --info: #2563eb; }
html, body { background: #ffffff !important; color: var(--text) !important; }
a { color: #2e8555; }
nav, .nav-wrap, .nav-toggle, .wechat-float { background: #ffffff !important; color: var(--text) !important; border-color: var(--border) !important; }
th, pre, code, .stat-card { background: var(--surface) !important; }
.callout-info { background: #eff6ff !important; color: var(--text) !important; }
.callout-warn { background: #fffbeb !important; color: var(--text) !important; }
.callout-tip { background: #ecfdf5 !important; color: var(--text) !important; }
.nav-wrap .nav-title { color: var(--primary) !important; }
.nav-wrap a, .wechat-float .info { color: var(--muted) !important; }
.nav-wrap a:hover { color: var(--primary) !important; }
.wechat-float .info strong { color: var(--text) !important; }
`;
}

function injectReportTheme(html, theme) {
  const normalized = normalizeReportTheme(theme);
  if (!normalized || typeof html !== 'string') return html;
  const marker = `<style id="${REPORT_THEME_STYLE_ID}" data-theme="${normalized}">${reportThemeCss(normalized)}</style>`;
  const withoutPrevious = html.replace(
    new RegExp(`<style[^>]*id=["']${REPORT_THEME_STYLE_ID}["'][^>]*>[\\s\\S]*?<\\/style>`, 'i'),
    '',
  );
  if (/<\/head\s*>/i.test(withoutPrevious)) {
    return withoutPrevious.replace(/<\/head\s*>/i, `${marker}</head>`);
  }
  return `${marker}${withoutPrevious}`;
}

function sendThemedHtmlFile(req, res, filePath) {
  const theme = normalizeReportTheme(req?.query?.theme);
  if (!theme || !isHtmlFile(filePath)) return false;
  const html = fs.readFileSync(filePath, 'utf8');
  res.type('html').set('Cache-Control', 'private, no-store').send(injectReportTheme(html, theme));
  return true;
}

function shouldThemeUpstream(req, upstream) {
  const theme = normalizeReportTheme(req?.query?.theme);
  const contentType = upstream?.headers?.get?.('content-type') || '';
  return Boolean(theme && (isHtmlFile(req?.params?.filename) || /text\/html/i.test(contentType)));
}

module.exports = {
  REPORT_THEME_STYLE_ID,
  injectReportTheme,
  isHtmlFile,
  normalizeReportTheme,
  reportThemeCss,
  sendThemedHtmlFile,
  shouldThemeUpstream,
};
