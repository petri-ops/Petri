/**
 * UI-706（BLOCK-455 D6/D7）— API Endpoint 主表简化契约（红绿先行）。
 *
 * 主表 11 列 → 8 列（协议/供应商/Base URL/Key/默认模型/上下文/连通性/删除）+ 行首展开钮；
 * 「思考/视觉/向量」能力位与「选择器/默认思考」全部移入行详情（EndpointRowDetail），
 * 能力声明模型级化（modelCapabilities 覆写 > 渠道兜底）。
 * 源码契约沿用 UI-703 先例（完整面板渲染依赖大量 IPC/store，文本断言更稳）。
 * 宽表头可达性（1146px 容器阈值 + 1180px 豁免）由 settings-redesign.models-exemption.test.ts 锁定，
 * 本契约只要求主表 min-width 不高于阈值。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../../../../');
const panelSrc = readFileSync(resolve(ROOT, 'frontend/src/components/desktop/DesktopSettingsPanel.tsx'), 'utf8');
const cssSrc = readFileSync(resolve(ROOT, 'frontend/src/components/desktop/desktop.css'), 'utf8');

describe('UI-706 API Endpoint 主表 8 列 + 行详情', () => {
  it('主表头不再出现 思考/视觉/向量 列（移入行详情）', () => {
    expect(panelSrc).not.toContain('<span>思考</span>');
    expect(panelSrc).not.toContain('<span>视觉</span>');
    expect(panelSrc).not.toContain('<span>向量</span>');
    expect(panelSrc).toContain('<span>上下文</span>');
    expect(panelSrc).toContain('<span>连通性</span>');
  });

  it('主行不再直挂能力开关/选择器控件，改由行详情承载', () => {
    expect(panelSrc).not.toContain('ModelSelectorControls');
    expect(panelSrc).not.toContain('<EndpointCapabilityToggle');
    expect(panelSrc).toContain('<EndpointRowDetail');
    expect(panelSrc).toContain('aria-expanded');
  });

  it('角色绑定候选接入已发现模型（availableModels 传入两个绑定组件）', () => {
    expect(panelSrc.match(/availableModels=\{availableModels\}/g)?.length).toBe(2);
  });

  it('CSS 主定义 = 9 轨道（32px 展开钮 + 5 弹性列 + 上下文 96px + 连通性 120px + 40px 删除）', () => {
    const block = cssSrc.match(/\.petri-endpoint-list-header,\s*\.petri-endpoint-card__grid\s*\{[^}]*\}/s)?.[0];
    expect(block).toBeTruthy();
    const columns = block!.match(/grid-template-columns:[^;]+;/s)?.[0] || '';
    expect(columns).toContain('32px');
    expect(columns).toContain('96px');
    expect(columns).toContain('120px');
    expect(columns.trim().endsWith('40px;')).toBe(true);
    expect(columns.match(/minmax\(/g)?.length).toBe(5);
    // 宽表头分支可达：主表最小宽 ≤ 容器查询阈值 1146px（UI-703 豁免战役成果不回归）
    const minWidth = Number(block!.match(/min-width:\s*(\d+)px/)?.[1]);
    expect(minWidth).toBeGreaterThanOrEqual(1048);
    expect(minWidth).toBeLessThanOrEqual(1146);
  });

  it('行详情样式在场（控件行 + 逐模型能力表）', () => {
    expect(cssSrc).toContain('.petri-endpoint-card__detail');
    expect(cssSrc).toContain('.petri-endpoint-detail__controls');
    expect(cssSrc).toContain('.petri-endpoint-detail__models');
  });
});