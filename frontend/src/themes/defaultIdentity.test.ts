/**
 * S5/P1-3 默认身份面可见性 — HK-01 红绿先行消费测试。
 *
 * R2 评估 P1-3：A0 裁决（B 青瓷·墨主 accent）落地后默认态仍不可见——
 * prefCache 默认 'teal' → applyAccent('teal') 移除 data-accent/data-surface →
 * 身份 token（--petri-ink-* / celadon / vermilion）组件面消费 0 处。
 * 本契约钉死（裁决真源 = acceptance/a0-identity-translation/ruling.json 现读）：
 * ① 无存储偏好时默认 accent = celadon-ink（不凭记忆写档名，锚 ruling 材料）
 * ② 默认档应用后 data-accent + data-surface 双属性在场（身份面默认可见）
 * ③ 显式保存过的偏好保留（旧配置迁移：存 teal 的用户不被覆盖）
 * ④ 身份 token 在组件面（custom.css 之外）真实消费 > 0（welcome 问候区 =
 *    宣纸墨字 + 朱砂落印点，A0 点睛 <5% 语义）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCachedAccent, writeCachedAccent } from './prefCache';
import { ACCENT_OPTIONS, applyAccent, surfaceForAccent } from './accents';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RULING = path.join(ROOT, 'acceptance', 'a0-identity-translation', 'ruling.json');
const WELCOME_CSS = path.join(ROOT, 'frontend', 'src', 'pages', 'welcome.module.css');

const ACCENT_STORAGE_KEY = 'petri-accent';

describe('默认身份面（A0 裁决落地 · S5/P1-3）', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-accent');
    document.documentElement.removeAttribute('data-surface');
  });

  it('裁决真源在场且判 celadon-ink 为工作态主 accent（不凭记忆写档名）', () => {
    interface A0Ruling { kind?: string; ruling?: string; resolves?: string; materialStatus?: string }
    const ruling = JSON.parse(readFileSync(RULING, 'utf8')) as A0Ruling;
    expect(ruling.ruling).toBe('行');
    expect(String(ruling.resolves)).toMatch(/青瓷·墨/);
    expect(String(ruling.resolves)).toMatch(/celadon|B 青瓷/);
  });

  it('无存储偏好时默认 accent = celadon-ink（A0 裁决档，非 teal）', () => {
    expect(readCachedAccent()).toBe('celadon-ink');
  });

  it('默认档应用后 data-accent + data-surface 双属性在场（身份面默认可见）', () => {
    applyAccent(readCachedAccent());
    expect(document.documentElement.getAttribute('data-accent')).toBe('celadon-ink');
    expect(document.documentElement.getAttribute('data-surface')).toBe('celadon');
    expect(surfaceForAccent('celadon-ink')).toBe('celadon');
  });

  it('旧配置迁移：显式保存过的偏好保留，不被默认覆盖（存 teal 得 teal）', () => {
    localStorage.setItem(ACCENT_STORAGE_KEY, 'teal');
    expect(readCachedAccent()).toBe('teal');
    applyAccent(readCachedAccent());
    // teal = 遗留基础档：token 在 :root，移除属性即基础身份（既有语义不变）
    expect(document.documentElement.hasAttribute('data-accent')).toBe(false);
    // 清理：写回路径存在（写过的用户显式值持久）
    writeCachedAccent('teal');
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBe('teal');
    localStorage.removeItem(ACCENT_STORAGE_KEY);
  });

  it('选项表恰好一档标注（默认）且为 celadon-ink', () => {
    const marked = ACCENT_OPTIONS.filter((o) => o.label.includes('（默认）'));
    expect(marked).toHaveLength(1);
    expect(marked[0].id).toBe('celadon-ink');
  });

  it('身份 token 组件面真实消费 > 0（welcome 问候区：墨字 + 朱砂落印）', () => {
    const css = readFileSync(WELCOME_CSS, 'utf8');
    expect(css, '问候字应消费骨架墨 token（宣纸墨字）').toContain('var(--petri-ink-base)');
    expect(css, '落印点应消费朱砂点睛 token（品牌落印 <5%）').toContain('var(--petri-accent-vermilion)');
    expect(css, '落印点应消费方印圆角 token（seal 语义）').toContain('var(--petri-radius-seal)');
  });
});
