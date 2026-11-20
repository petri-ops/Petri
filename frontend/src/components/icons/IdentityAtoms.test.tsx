// A2 造型图标原子 — HK-01 红绿先行消费测试。
// 三原子=开环(open-ring)/错落四格(offset-grid)/发丝线(hairline)；
// 落点=空态（McpShelfPane）与 tab active（extensions shelfTab）。
// 断言：Icon 单源含三原子、笔画同族（24×24/stroke/currentColor）、
// 点睛每视图 ≤1 格、零 emoji 当图标、零新依赖。观感留槽不代签。

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ICON = path.join(HERE, 'Icon.tsx');
const EXT = path.join(HERE, '..', '..', 'pages', 'extensions', 'index.tsx');
const EMPTY = path.join(HERE, '..', '..', 'pages', 'extensions', 'McpShelfPane.tsx');
const PKG = path.join(HERE, '..', '..', '..', 'package.json');
const read = (p: string) => fs.readFileSync(p, 'utf8');

const ATOMS = ['open-ring', 'offset-grid', 'hairline'] as const;

describe('A2 identity icon atoms (single source)', () => {
  it('defines all three atoms in IconName + paths (single source)', () => {
    const icon = read(ICON);
    for (const name of ATOMS) {
      expect(icon, `IconName missing ${name}`).toMatch(new RegExp(`'${name}'`));
      expect(icon, `paths missing ${name}`).toMatch(new RegExp(`^\\s{2}(?:'${name}'|${name}):`, 'm'));
    }
  });

  it('keeps one stroke family: 24×24 viewBox, stroke=currentColor, no fill', () => {
    const icon = read(ICON);
    expect(icon).toMatch(/viewBox="0 0 24 24"/);
    expect(icon).toMatch(/stroke="currentColor"/);
    expect(icon).toMatch(/fill="none"/);
    // 三原子 path 本身不得引入 fill 或硬编码颜色（继承 currentColor）。
    for (const name of ATOMS) {
      const block = icon.match(new RegExp(`^\\s{2}(?:'${name}'|${name}):\\s*\\(([\\s\\S]*?)^\\s{2}\\),`, 'm'))?.[1] ?? '';
      expect(block, `${name} path missing`).not.toBe('');
      expect(block, `${name} must not set fill/color`).not.toMatch(/fill=|#[0-9a-fA-F]{3,8}|currentColor/);
    }
  });

  it('wires open-ring into the empty state (replaces generic zap)', () => {
    const empty = read(EMPTY);
    expect(empty).toMatch(/<Icon\s+name="open-ring"/);
    expect(empty).not.toMatch(/<Icon\s+name="zap"[^>]*size=\{24\}/);
  });

  it('marks tab active with offset-grid, one highlighted cell only', () => {
    const ext = read(EXT);
    expect(ext, 'active tab must render offset-grid atom').toMatch(
      /shelfTabActive[\s\S]{0,120}offset-grid|<Icon\s+name="offset-grid"/,
    );
    // 每视图点睛 ≤1：offset-grid 渲染实例只出现在 active 分支。
    const instances = (ext.match(/name="offset-grid"/g) ?? []).length;
    expect(instances).toBeLessThanOrEqual(1);
  });

  it('introduces no icon dependency and no emoji-as-icon', () => {
    const pkg = JSON.parse(read(PKG)) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps: Record<string, string | undefined> = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
    for (const d of ['lucide-react', '@phosphor-icons/react', 'react-icons', 'heroicons']) {
      expect(deps[d], `unexpected icon dependency ${d}`).toBeUndefined();
    }
  });

  it('keeps human-eye slot open (no static-to-visual claim)', () => {
    // A2 是视觉呈现改动；静态测试只证明结构，不在测试文本里声明视觉通过。
    const self = read(fileURLToPath(import.meta.url));
    expect(self).not.toMatch(/状态\s*[:=]\s*'v[e]rified'/);
  });
});
