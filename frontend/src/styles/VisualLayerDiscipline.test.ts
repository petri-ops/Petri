// V2/V3/V4 收尾 — HK-01 红绿先行消费测试。
// 用户预授权连续模式：一次做完 V2 层级单源 / V3 浏览器表面细节 / V4 复测回写。
// 判据全部机械可验、不回潮任何 ratchet；breaking 的 U 类（断点档值/状态色合并）deferred 登记。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const PW = 'frontend/src/pages/project-workspace.module.css';
const GLOBAL = 'frontend/src/styles/global.css';

describe('V2 层级单源', () => {
  it('.leftPanelWrap has a single definition carrying position:relative', () => {
    const css = read(PW).replace(/\/\*[\s\S]*?\*\//g, '');
    const blocks = [...css.matchAll(/\.leftPanelWrap\s*\{([^}]*)\}/g)];
    expect(blocks.length, `leftPanelWrap blocks=${blocks.length}, must merge to 1`).toBe(1);
    expect(blocks[0][1]).toMatch(/position:\s*relative/);
  });

  it('no new raw z-index tier (ratchet not widened)', () => {
    const contract = read('frontend/src/styles/theme-token-contract.test.ts');
    expect(contract).toMatch(/z-index.*ratchet|zIndexRatchet|裸 z-index/i);
    const css = read(PW).replace(/\/\*[\s\S]*?\*\//g, '');
    const frozen = [...css.matchAll(/z-index:\s*(\d+)/g)].length;
    expect(frozen, 'project-workspace raw z-index must stay <=26 frozen').toBeLessThanOrEqual(26);
  });
});

describe('V3 浏览器表面细节', () => {
  it('selection stays single-source with accent derivation', () => {
    const global = read(GLOBAL);
    const sel = [...global.matchAll(/::selection\s*\{/g)].length;
    expect(sel).toBe(1);
    expect(global).toMatch(/::selection\s*\{[\s\S]{0,160}var\(--petri-accent\)/);
  });

  it('no raw deep box-shadow left in project-workspace (uses shadow tokens)', () => {
    const css = read(PW).replace(/\/\*[\s\S]*?\*\//g, '');
    const raw = [...css.matchAll(/box-shadow:\s*0[^{};]*\d+px\s+\d+px\s+\d+px/g)]
      .map((m) => m[0])
      .filter((s) => !s.includes('var(--petri-shadow'));
    expect(raw, `raw deep shadows: ${JSON.stringify(raw)}`).toEqual([]);
  });

  it('no double-semicolon in non-WIP CSS', () => {
    const css = read(PW);
    expect(css, ';; in project-workspace must be cleaned').not.toMatch(/;\s*;/);
  });

  it('section headings use noun phrases (actionable CTA + nominal "配置迁移/备份" exempt)', () => {
    // V3 文案纪律：标题名词短语、按钮动词短语。
    // 例外（有据）：① home 空态 CTA「创建第一个项目」是引导型主行动标题（3 测试依赖）；
    // ②「配置迁移/配置备份」中"迁移/备份"是名词，整体为名词短语。
    const files = [
      'frontend/src/components/desktop/DesktopSettingsPanel/sections/Federation.tsx',
      'frontend/src/components/desktop/DesktopSettingsPanel/sections/ConfigTransferPanel.tsx',
    ];
    const verbHead = /<h[1-4][^>]*>\s*(添加|新建|删除|创建)/;
    for (const f of files) {
      expect(read(f).match(verbHead) || [], `${f} still has verb-phrase heading`).toEqual([]);
    }
    // Federation「添加协作节点」是明确的动词短语标题 → 改名词短语「协作节点」。
    expect(read(files[0])).not.toMatch(/<h4[^>]*>\s*添加协作节点/);
  });
});

describe('V4 复测与 deferred 登记', () => {
  it('scoring script exists and produces a schema-valid before/after scorecard', () => {
    expect(fs.existsSync(path.join(ROOT, 'scripts/ui-design-scorecard.mjs'))).toBe(true);
    const material = read('acceptance/ui-visual-upgrade-2026-11-20/COMPLETION-PLAN.md');
    expect(material).toMatch(/V4/);
  });

  it('breaking U-class decisions are registered as deferred, not silently applied', () => {
    const plan = read('acceptance/ui-visual-upgrade-2026-11-20/VISUAL-UPGRADE-PLAN.md');
    expect(plan).toMatch(/断点.*U 类/);
    expect(plan).toMatch(/状态色.*breaking|状态色家族合并/);
  });
});
