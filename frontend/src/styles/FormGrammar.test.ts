// 艺术性造型升级 — HK-01 红绿先行消费测试。
// 用户反馈：图标小卡片都方方正正、不够高级/个性。
// 方案：形态语义层级——印章(近方3px)/图标座(squircle 10px)/纸面区块(14px)/胶囊(999)，
// 让方/圆/环各有身份；点睛方印与开环呼应，不用同一模子。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const CUSTOM = 'frontend/src/styles/custom.css';
const CONTRACT = 'frontend/src/styles/theme-token-contract.test.ts';
const ICON = 'frontend/src/components/icons/Icon.tsx';

describe('形态语义层级（form grammar）', () => {
  it('defines three semantic radius tiers with ascending squircle values', () => {
    const css = read(CUSTOM);
    const val = (t: string) => Number(css.match(new RegExp(`${t}:\\s*(\\d+)px`))?.[1] ?? 0);
    const seal = val('--petri-radius-seal');
    const icon = val('--petri-radius-icon');
    const card = val('--petri-radius-card');
    expect(seal, 'seal must exist (近方印记)').toBeGreaterThanOrEqual(2);
    expect(icon, 'icon seat must exist (squircle)').toBeGreaterThanOrEqual(9);
    expect(card, 'card must exist (纸面柔边)').toBeGreaterThanOrEqual(12);
    expect(seal).toBeLessThan(icon);
    expect(icon).toBeLessThan(card);
  });

  it('contract whitelist includes new tiers (tier set + dark exemption)', () => {
    const contract = read(CONTRACT);
    for (const t of ['--petri-radius-seal', '--petri-radius-icon', '--petri-radius-card']) {
      expect(contract, `${t} missing in contract tier list`).toContain(t);
    }
  });

  it('high-frequency icon seats consume the icon-seat tier (not the generic square)', () => {
    const seats: Array<[string, string]> = [
      ['frontend/src/components/desktop/TitleBar.module.css', '.iconBtn'],
      ['frontend/src/pages/home.module.css', '.workbenchCardIcon'],
      ['frontend/src/pages/project-workspace.module.css', '.emptyResultLaunchIcon'],
    ];
    for (const [file, cls] of seats) {
      const css = read(file);
      const block = css.match(new RegExp(`${cls.replace('.', '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
      expect(block, `${file} ${cls} missing`).not.toBe('');
      expect(block, `${file} ${cls} still square`).toMatch(/border-radius:\s*var\(--petri-radius-icon\)/);
    }
  });

  it('workbench hero icon uses card squircle, empty badge is a circular seal', () => {
    const home = read('frontend/src/pages/home.module.css');
    const hero = home.match(/\.workbenchIcon\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(hero).toMatch(/border-radius:\s*var\(--petri-radius-card\)/);
    const pw = read('frontend/src/pages/project-workspace.module.css');
    const badge = pw.match(/\.emptyResultBadge\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(badge, 'empty badge must be a circular mark (月洞/印记)').toMatch(/border-radius:\s*50%/);
  });

  it('Icon single-source has a seal-square atom (方印点睛) reusing round stroke family', () => {
    const icon = read(ICON);
    expect(icon).toMatch(/'seal-square'/);
    const block = icon.match(/'seal-square':\s*\(([\s\S]*?)^\s{2}\),/m)?.[1] ?? '';
    expect(block).not.toBe('');
    expect(block).toMatch(/<rect|<path/);
  });

  it('no new icon dependency and no radius ratchet regression', () => {
    const pkg = JSON.parse(read('frontend/package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps: Record<string, string | undefined> = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const d of ['lucide-react', '@phosphor-icons/react', 'react-icons', 'heroicons']) {
      expect(deps[d], `unexpected dependency ${d}`).toBeUndefined();
    }
  });

  it('no static-to-visual sign-off claim', () => {
    const self = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
    expect(self).not.toMatch(/expect\([^)]*verified[^)]*\)\.toBe\(true\)/);
  });
});
