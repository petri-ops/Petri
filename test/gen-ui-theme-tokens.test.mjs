/**
 * BLOCK-166 P1 主题映射漂移守卫（plan §6-坑 15：guest CSS 的 --petri-* 值读取
 * 须从 token 单源取，禁止在 shell 拼装处硬编码漂移色值）。
 *
 * theme.js 的 THEME_VAR_MAP 是「petri token → gen-ui 标准变量」的字面值映射层；
 * 本测试逐条比对 frontend/src/styles/custom.css 的声明值（:root 亮色 /
 * html[data-theme='dark'] 暗色 / [data-accent] 派生档），token 单源一改这里就红，
 * 提醒同步 theme.js——机械同步替代人肉记忆。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { THEME_VAR_MAP, buildGenUiThemeCss } = require('../src/main/gen-ui/theme.js');

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const customCss = fs.readFileSync(path.join(REPO_ROOT, 'frontend', 'src', 'styles', 'custom.css'), 'utf8');

function sectionAfter(marker, text = customCss) {
  const idx = text.indexOf(marker);
  assert.ok(idx >= 0, `custom.css 缺少标记 ${marker}`);
  return text.slice(idx);
}

function untilClosingBrace(text) {
  const end = text.indexOf('\n}');
  return end >= 0 ? text.slice(0, end) : text;
}

const lightSection = customCss.slice(customCss.indexOf(':root {'), customCss.indexOf("html[data-theme='dark'],"));
const darkSection = untilClosingBrace(sectionAfter("html[data-theme='dark'],"));
const violetLight = untilClosingBrace(sectionAfter("[data-accent='violet'] {"));
const violetDark = untilClosingBrace(sectionAfter("[data-accent='violet'][data-theme='dark'] {"));
const amberLight = untilClosingBrace(sectionAfter("[data-accent='amber'] {"));
const amberDark = untilClosingBrace(sectionAfter("[data-accent='amber'][data-theme='dark'] {"));

function tokenValue(section, token) {
  const stripped = section.replace(/\/\*[\s\S]*?\*\//g, ''); // 注释里列举的令牌名不算声明
  const escaped = token.replace(/[-]/g, '\\$&');
  const m = stripped.match(new RegExp(`${escaped}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}

const ACCENT_SECTIONS = {
  'accent:violet': { light: violetLight, dark: violetDark },
  'accent:amber': { light: amberLight, dark: amberDark },
};

test('THEME_VAR_MAP 与 custom.css token 单源逐条一致（亮/暗）', () => {
  assert.ok(Object.keys(THEME_VAR_MAP).length >= 20, '映射表覆盖任务书 §7 标准变量集');
  for (const [name, entry] of Object.entries(THEME_VAR_MAP)) {
    let lightExpect;
    let darkExpect;
    if (entry.source.startsWith('--petri-')) {
      lightExpect = tokenValue(lightSection, entry.source);
      darkExpect = tokenValue(darkSection, entry.source);
    } else if (ACCENT_SECTIONS[entry.source]) {
      lightExpect = tokenValue(ACCENT_SECTIONS[entry.source].light, '--petri-accent');
      darkExpect = tokenValue(ACCENT_SECTIONS[entry.source].dark, '--petri-accent');
    } else {
      throw new Error(`未知 source：${entry.source}（${name}）`);
    }
    assert.ok(lightExpect, `${name} 亮色源 token ${entry.source} 在 custom.css 未找到`);
    assert.ok(darkExpect, `${name} 暗色源 token ${entry.source} 在 custom.css 未找到`);
    assert.equal(
      entry.light, lightExpect,
      `${name}.light 漂移：theme.js=${entry.light} custom.css=${lightExpect}（同步 theme.js）`,
    );
    assert.equal(
      entry.dark, darkExpect,
      `${name}.dark 漂移：theme.js=${entry.dark} custom.css=${darkExpect}（同步 theme.js）`,
    );
  }
});

test('派生层：muted 用 color-mix 派生、viz 序列引用已映射变量、字号 14px', () => {
  const css = buildGenUiThemeCss();
  assert.ok(css.includes('--muted:color-mix(in srgb,var(--foreground) 10%,transparent)'), '--muted derived');
  assert.ok(css.includes('--viz-series-1:var(--primary)'), 'series 1 = primary');
  for (let i = 2; i <= 6; i += 1) {
    assert.ok(css.includes(`--viz-series-${i}:var(--`), `series ${i} references mapped var`);
  }
  assert.ok(css.includes('--font-size-base:14px'), 'base font size');
});
