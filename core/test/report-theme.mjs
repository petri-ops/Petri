import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  REPORT_THEME_STYLE_ID,
  injectReportTheme,
  normalizeReportTheme,
} = require('../r-server/helpers/report-theme');

test('report themes accept only resolved light and dark values', () => {
  assert.equal(normalizeReportTheme('light'), 'light');
  assert.equal(normalizeReportTheme('dark'), 'dark');
  assert.equal(normalizeReportTheme('system'), null);
});

test('injected report theme is explicit and replaces the previous theme', () => {
  const source = '<html><head></head><body><nav class="nav-wrap"></nav></body></html>';
  const dark = injectReportTheme(source, 'dark');
  assert.match(dark, new RegExp(`id="${REPORT_THEME_STYLE_ID}" data-theme="dark"`));
  assert.match(dark, /background: #0b1120/);

  const light = injectReportTheme(dark, 'light');
  assert.equal((light.match(new RegExp(REPORT_THEME_STYLE_ID, 'g')) || []).length, 1);
  assert.match(light, /data-theme="light"/);
  assert.match(light, /--text: #17201d/);
  assert.doesNotMatch(light, /background: #0b1120/);
});
