// V5 身份面上线 — HK-01 红绿先行消费测试。
// 用户裁决「行」：四套和声注册为 [data-accent] 新档位，与现有 5 档并存，
// 复用 ThemeProvider/localStorage/data-accent 现成管道；选中档位即"可见品牌面"。
// 断言：① 新 id 进前端白名单并与服务端 schema 一致 ② 选项表含四档
// ③ custom.css 每档 light/dark 双套定义且非机械反色 ④ 点睛 token 语义在
// ⑤ 零新依赖、观感零代签。

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCENT_OPTIONS } from './accents';
import { ACCENT_VALUES, isAccentId, type AccentId } from './prefCache';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CSS = path.join(ROOT, 'frontend', 'src', 'styles', 'custom.css');
const FRONTEND_PKG = path.join(ROOT, 'frontend', 'package.json');
const SCHEMA = path.join(ROOT, 'core', 'packages', 'shared-config', 'config-schema.js');
const PKG = FRONTEND_PKG;

const HARMONY = [
  { id: 'paper-vermilion', light: '#b5482f', dark: '#d97055', ink: 'paper' },
  { id: 'celadon-ink', light: '#0f766e', dark: '#2fd7d2', ink: 'celadon' },
  { id: 'ultramarine-brass', light: '#a87c42', dark: '#c9a063', ink: 'ultramarine' },
  { id: 'indigo-mist', light: '#6e9ca0', dark: '#8fb8bb', ink: 'indigo' },
] as const;

describe('V5 harmony accents (可见品牌面)', () => {
  it('four harmony ids are in frontend whitelist and predicate', () => {
    for (const h of HARMONY) {
      expect(ACCENT_VALUES, `${h.id} missing in whitelist`).toContain(h.id);
      expect(isAccentId(h.id), `${h.id} rejected by predicate`).toBe(true);
    }
  });

  it('frontend whitelist matches server schema (drift contract)', () => {
    const schema = fs.readFileSync(SCHEMA, 'utf8');
    const m = schema.match(/key:\s*'userPrefs\.accent'[\s\S]{0,200}?oneOf:\s*\[([^\]]+)\]/);
    expect(m, 'server accent domain not found').toBeTruthy();
    const serverIds = [...(m![1].match(/'[^']+'/g) || [])].map((s) => s.slice(1, -1));
    expect([...ACCENT_VALUES].sort()).toEqual(serverIds.sort());
  });

  it('ACCENT_OPTIONS exposes all four with distinct labels/swatches', () => {
    const labels = new Set<string>();
    const swatches = new Set<string>();
    for (const h of HARMONY) {
      const opt = ACCENT_OPTIONS.find((o) => o.id === (h.id as AccentId));
      expect(opt, `${h.id} missing option`).toBeTruthy();
      expect(opt!.label.length).toBeGreaterThan(1);
      labels.add(opt!.label);
      swatches.add(opt!.swatch.toLowerCase());
    }
    expect(labels.size).toBe(4);
    expect(swatches.size).toBe(4);
  });

  it('each harmony has light + dark CSS blocks with non-identical accent', () => {
    const css = fs.readFileSync(CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const h of HARMONY) {
      const light = css.match(new RegExp(`\\[data-accent='${h.id}'\\]\\s*\\{([^}]*)\\}`))?.[1] ?? '';
      const dark = css.match(new RegExp(`\\[data-accent='${h.id}'\\]\\[data-theme='dark'\\]\\s*\\{([^}]*)\\}`))?.[1] ?? '';
      expect(light, `${h.id} light block missing`).not.toBe('');
      expect(dark, `${h.id} dark block missing`).not.toBe('');
      expect(light, `${h.id} light accent wrong`).toMatch(new RegExp(`--petri-accent:\\s*${h.light}`, 'i'));
      expect(dark, `${h.id} dark accent wrong`).toMatch(new RegExp(`--petri-accent:\\s*${h.dark}`, 'i'));
      // 骨架/点睛双段和声：每档至少定义 accent + accent-bg。
      for (const block of [light, dark]) {
        expect(block).toMatch(/--petri-accent-bg\s*:/);
      }
    }
  });

  it('no new icon/theme dependency introduced', () => {
    const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps: Record<string, string | undefined> = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const d of ['lucide-react', '@phosphor-icons/react', 'react-icons', 'heroicons']) {
  // eslint-disable-next-line security/detect-object-injection -- 可信契约读数面（canonical 快照封闭词表键），启发式误报；R2 清偿批 S8 依 BLOCK-493 先例行级豁免留痕
      expect(deps[d], `unexpected dependency ${d}`).toBeUndefined();
    }
  });

  it('no visual sign-off from static evidence', () => {
    const self = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
    expect(self).not.toMatch(/expect\([^)]*verified[^)]*\)\.toBe\(true\)/);
  });
});
