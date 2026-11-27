/**
 * B1 z-index 六档语义 token — HK-01 红绿先行 static 契约（队列 3）。
 *
 * 核真基线（2026-11-25）：全仓裸 z-index:N 共 104 处（CSS 94 + TS/TSX 内联 10），
 * 数值军备竞赛且语义倒挂：Lightbox(100000) > 登录/顶栏(10000) > 分支标签(10001)
 * > Toast(9999) > 全屏遮罩(9998)。本契约钉住：九档 token 严格递增、Toast 最高、
 * 顶层通知确实走 toast、普通遮罩与弹窗分层、零裸数值、零新依赖、双主题与
 * reduced-motion 兜底不被破坏。
 */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'frontend', 'src');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (!/\.(css|ts|tsx|js|jsx)$/.test(entry.name)) continue;
    if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^\S\r\n])\/\/.*$/gm, '$1');
}

// 与主题门 BLOCK-413 同一计数口径：只罚字面量，var(--petri-z-*) 不命中。
const BARE_Z = /z-?[Ii]ndex\s*:\s*(?!["'`]?\s*var\()\d/g;
const TIERS = ['base', 'raised', 'sticky', 'dropdown', 'overlay', 'modal', 'chrome', 'lightbox', 'toast'];
const CUSTOM = read('frontend/src/styles/custom.css');
const zValue = (tier) => {
  const m = CUSTOM.match(new RegExp(`--petri-z-${tier}\\s*:\\s*(\\d+)`));
  return m ? Number(m[1]) : null;
};
const uses = (rel, tier) => new RegExp(`var\\(--petri-z-${tier}\\)`).test(read(rel));

test('B1-1 九档语义 token 定义完整且严格递增（chrome 档为标题栏专用）', () => {
  const values = TIERS.map(zValue);
  for (let i = 0; i < TIERS.length; i += 1) {
    assert.notEqual(values.at(i), null, `--petri-z-${TIERS.at(i)} 未定义`);
  }
  for (let i = 1; i < values.length; i += 1) {
    assert.ok(values.at(i) > values.at(i - 1), `${TIERS.at(i)}(${values.at(i)}) 必须高于 ${TIERS.at(i - 1)}(${values.at(i - 1)})`);
    assert.ok(values.at(i) - values.at(i - 1) >= 10, `${TIERS.at(i)} 与 ${TIERS.at(i - 1)} 之间须留扩展空间`);
  }
});

test('B1-2 Toast > 标题栏与弹窗；弹窗 > 普通遮罩（语义倒挂修复）', () => {
  const toast = zValue('toast');
  const chrome = zValue('chrome');
  const modal = zValue('modal');
  const overlay = zValue('overlay');
  assert.ok(toast > chrome, `Toast(${toast}) 必须高于标题栏(${chrome})`);
  assert.ok(toast > modal, `Toast(${toast}) 必须高于弹窗(${modal})`);
  assert.ok(toast > zValue('lightbox'), 'Toast 必须是最高档');
  assert.ok(chrome > modal, `标题栏(${chrome}) 须高于普通弹窗(${modal})，保持顶栏常驻可见`);
  assert.ok(modal > overlay, `登录/确认弹窗(${modal}) 必须高于普通遮罩(${overlay})`);
  // 关键语义锚点静态核验：顶层通知确实走 toast，标题栏走 chrome，菜单不再裸写 10000/10001。
  assert.equal(uses('frontend/src/components/desktop/CrashNoticeBanner.tsx', 'toast'), true, '崩溃通知须走 toast');
  assert.equal(uses('frontend/src/themes/ThemeProvider.tsx', 'toast'), true, '同步失败通知须走 toast');
  assert.equal(uses('frontend/src/pages/project-workspace.module.css', 'toast'), true, 'workspaceNotice 须走 toast');
  assert.equal(uses('frontend/src/components/desktop/titlebar/ColumnizedTitleBar.module.css', 'chrome'), true, '列式标题栏须走 chrome');
  const titleBar = read('frontend/src/components/desktop/TitleBar.module.css');
  assert.equal(BARE_Z.test(titleBar), false, '标题栏菜单不得再裸写 10000/10001');
  BARE_Z.lastIndex = 0;
  assert.equal(/var\(--petri-z-toast\)/.test(titleBar), false, '标题栏悬浮层不得占用 toast 档');
});

test('B1-3 全源零裸 z-index（CSS 94 + 内联 10 全量 token 化）', () => {
  const offenders = [];
  let tokenUses = 0;
  for (const file of walk(SRC)) {
    const text = stripComments(fs.readFileSync(file, 'utf8'));
    const hits = text.match(BARE_Z);
    BARE_Z.lastIndex = 0;
    if (hits && hits.length) offenders.push(`${path.relative(SRC, file)}:${hits.length}`);
    tokenUses += (text.match(/var\(--petri-z-[a-z]+\)/g) || []).length;
  }
  assert.deepEqual(offenders, [], `仍有裸 z-index：${offenders.join(', ')}`);
  assert.ok(tokenUses >= 104, `语义 token 引用仅 ${tokenUses} 处，应 ≥104`);
});

test('B1-4 双主题与 reduced-motion 兜底不被破坏', () => {
  const custom = stripComments(CUSTOM);
  const global = stripComments(read('frontend/src/styles/global.css'));
  // z 档位是主题无关的功能 token：只在 :root 定义一次，暗色块不重复定义（避免双主题漂移）。
  const defs = custom.match(/--petri-z-[a-z]+\s*:/g) || [];
  assert.equal(defs.length, TIERS.length, `z token 定义应恰好 ${TIERS.length} 处（仅 :root）`);
  assert.equal(/--petri-z-[a-z]+\s*:/.test(global), false, 'global.css 不得重复定义 z token');
  assert.equal(/html\[data-theme='dark'\][^{]*\{[^}]*--petri-z-/.test(custom), false, '暗色块不得另立 z 档位');
  assert.equal(/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(global), true, 'reduced-motion 兜底须保留');
});

test('B1-5 零新依赖（package.json 依赖清单与 HEAD 逐键一致）', () => {
  const current = JSON.parse(read('package.json'));
  const baseline = JSON.parse(execFileSync('git', ['show', 'HEAD:package.json'], { cwd: ROOT, encoding: 'utf8' }));
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const cur = Object.entries(current).find(([k]) => k === key)?.[1] ?? {};
    const base = Object.entries(baseline).find(([k]) => k === key)?.[1] ?? {};
    assert.deepEqual(cur, base, `${key} 不得新增依赖`);
  }
});

test('B1-6 计数器合成红自证（新增裸值即红、token 形态不误伤）', () => {
  assert.equal(('div { z-index: 9999; }'.match(BARE_Z) || []).length, 1, '合成裸值须命中');
  BARE_Z.lastIndex = 0;
  assert.equal(('style={{ zIndex: 100000 }}'.match(BARE_Z) || []).length, 1, '合成内联裸值须命中');
  BARE_Z.lastIndex = 0;
  assert.equal(('div { z-index: var(--petri-z-toast); }'.match(BARE_Z) || []).length, 0, 'token 形态不得误伤');
  BARE_Z.lastIndex = 0;
});
