// A3 排版留白 — HK-01 红绿先行消费测试。
// 三纪律（东方排版语境）：①标题更宽字距 + 更重字重 ②技术/英文标签横排小字注脚
// ③落印位（标题下方极小标记）+ 内容占比留白纪律。
// 红线：不新增 accent 引用（ratchet 只减不增）；落印位用中性 token；不改 ratchet 基线。
// 观感零代签：静态测试只证明结构，不声明视觉通过。

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WELCOME_CSS = path.join(ROOT, 'pages', 'welcome.module.css');
const SETTINGS_CSS = path.join(ROOT, 'components', 'desktop', 'settings-redesign.module.css');
const read = (p: string) => fs.readFileSync(p, 'utf8');
const block = (css: string, selector: string) =>
  css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

describe('A3 editorial rhythm (欢迎页 + 设置页)', () => {
  it('welcome greeting uses wider tracking with heavy weight (竖排标题重量转译)', () => {
    const g = block(read(WELCOME_CSS), '.greeting');
    expect(g).toMatch(/font-weight:\s*700/);
    expect(g, 'greeting must have letter-spacing').toMatch(/letter-spacing:\s*[\d.]+em/);
    const ls = Number(g.match(/letter-spacing:\s*([\d.]+)em/)?.[1] ?? 0);
    expect(ls, 'tracking must be wider than body (>=0.03em)').toBeGreaterThanOrEqual(0.03);
  });

  it('welcome subtitle is the horizontal footnote role (英/技术标签位)', () => {
    const s = block(read(WELCOME_CSS), '.welcomeSub');
    expect(s).toMatch(/letter-spacing:\s*[\d.]+em/);
    expect(s).toMatch(/--petri-text-secondary|--petri-text-tertiary/);
  });

  it('settings visible section heading tracking widened (>=0.03em), neutral seal present', () => {
    const css = read(SETTINGS_CSS);
    const title = css.match(/\.petri-settings-section__heading\)\s*h3\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(title, 'visible section heading rule must exist').not.toBe('');
    expect(title).toMatch(/font-weight:\s*600/);
    const ls = Number(title.match(/letter-spacing:\s*([\d.]+)em/)?.[1] ?? 0);
    expect(ls, 'visible heading tracking must widen (was 0.01em)').toBeGreaterThanOrEqual(0.03);
    // 落印位挂在真实可见的分区标题上（A4 轮1抓真）。
    expect(css, 'neutral seal on visible heading').toMatch(
      /\.petri-settings-section__heading\)\s*::after\s*\{[\s\S]{0,200}(--petri-text-tertiary|--petri-border)/,
    );
  });

  it('seal mark introduces no accent token (ratchet only-tighten)', () => {
    const css = read(SETTINGS_CSS);
    const seal = css.match(/\.petri-settings-section__heading\)\s*::after\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(seal, 'seal block must exist').not.toBe('');
    expect(seal).not.toMatch(/--petri-accent/);
  });

  it('no new bare-color literals in the touched CSS blocks', () => {
    for (const file of [WELCOME_CSS, SETTINGS_CSS]) {
      const css = read(file);
      const touched = block(css, '.greeting') + block(css, '.welcomeSub');
      expect(touched).not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(/);
    }
  });
});
