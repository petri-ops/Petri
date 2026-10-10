import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  injectReportTheme,
  isHtmlFile,
  normalizeReportTheme,
  REPORT_THEME_STYLE_ID,
} = require('../core/petri-server/helpers/report-theme.js');

test('accepts only explicit light and dark report themes', () => {
  assert.equal(normalizeReportTheme('light'), 'light');
  assert.equal(normalizeReportTheme('dark'), 'dark');
  assert.equal(normalizeReportTheme('system'), null);
  assert.equal(normalizeReportTheme('dark"><script>'), null);
});

test('recognizes html report extensions case-insensitively', () => {
  assert.equal(isHtmlFile('report.html'), true);
  assert.equal(isHtmlFile('REPORT.HTM'), true);
  assert.equal(isHtmlFile('report.pdf'), false);
});

test('injects dark report CSS before head close', () => {
  const themed = injectReportTheme('<html><head><title>x</title></head><body>x</body></html>', 'dark');
  assert.match(themed, new RegExp(`id="${REPORT_THEME_STYLE_ID}"`));
  assert.match(themed, /background: #0b1120/);
  assert.ok(themed.indexOf(REPORT_THEME_STYLE_ID) < themed.indexOf('</head>'));
});

test('replaces a previous injected style rather than duplicating it', () => {
  const dark = injectReportTheme('<html><head></head><body>x</body></html>', 'dark');
  const light = injectReportTheme(dark, 'light');
  assert.equal((light.match(new RegExp(REPORT_THEME_STYLE_ID, 'g')) || []).length, 1);
  assert.match(light, /data-theme="light"/);
  assert.doesNotMatch(light, /background: #0b1120/);
});

test('leaves HTML untouched for invalid themes', () => {
  const html = '<html><body>x</body></html>';
  assert.equal(injectReportTheme(html, 'system'), html);
});
