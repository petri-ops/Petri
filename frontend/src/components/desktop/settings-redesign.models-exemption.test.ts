import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * UI-703 宽表头可达性契约（W8 实机腿发现）：
 * settings-redesign 的 `> * { max-width: 720px }` 兜底帽（BLOCK-423 引入）把
 * `.petri-settings-section--models { width: min(100%, 1180px) }`（UI-038 引入，
 * 容器 ≥1146px 才显示 11 列表头）压死——宽表头分支在一切窗口宽度都不可达。
 * 修复 = 兜底帽之后登记 models 豁免（同文件更晚出现 + 更高特异性）；
 * 本测试钉「豁免在兜底帽之后、且豁免值 ≥ 容器查询阈值所需宽度」。
 */
describe('UI-703 宽表头可达性（models 分区豁免 720 兜底帽）', () => {
  const src = readFileSync(resolve(__dirname, 'settings-redesign.module.css'), 'utf8');

  it('兜底帽在场（720px）且 models 豁免在其之后登记', () => {
    const blanket = src.indexOf('.petri-settings-content) > *');
    const exemption = src.indexOf('.petri-settings-content) > :global(.petri-settings-section--models)');
    expect(blanket).toBeGreaterThan(-1);
    expect(exemption).toBeGreaterThan(blanket);
  });

  it('豁免值为 1180px（≥ 容器查询 1146px 阈值 + 余量）', () => {
    const exemption = src.indexOf('.petri-settings-content) > :global(.petri-settings-section--models)');
    expect(exemption).toBeGreaterThan(-1);
    const tail = src.slice(exemption, exemption + 240);
    expect(tail).toMatch(/max-width:\s*1180px/);
  });
});
