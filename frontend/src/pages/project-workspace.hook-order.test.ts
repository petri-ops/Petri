import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 回归门（P6 渲染层实机抓真，UI-378 同族第二例）：
 *
 * BLOCK-86 P2 曾把运行时横幅的 useState/useEffect 追加在 ProjectWorkspace 的三个
 * 组件级早退（`if (loading)` / `if (error && !project)` / `if (!project)`）之后——
 * 首渲染（项目加载中）走早退只调到前面的 hook，项目加载完成后的下一渲染才第一次
 * 走到该 useState → React 抛「Rendered more hooks than during the previous render」
 * 并卸载整棵树（页面全白，Result Studio 面板永不挂载，P6/P4R Electron 实机链全红）。
 *
 * 本测试锁定不变量：ProjectWorkspace 组件体内所有 React hook 调用必须出现在
 * 第一个组件级早退之前。新增 hook 一律写在早退守卫上方。
 */

const source = readFileSync(resolve(__dirname, 'project-workspace.tsx'), 'utf8');
const lines = source.split(/\r?\n/);

const componentStart = lines.findIndex((line) => line.includes('export function ProjectWorkspace'));
const componentEnd = lines.findIndex((line, index) => index > componentStart && line.startsWith('}'));
const firstEarlyReturn = lines.findIndex(
  (line, index) => index > componentStart && line.trim() === 'if (loading) {',
);
const hookCall = /\buse[A-Z][A-Za-z0-9]*\s*[<(]/;

describe('ProjectWorkspace hook order', () => {
  it('组件与其早退守卫都存在（防止测试静默失效）', () => {
    expect(componentStart).toBeGreaterThan(0);
    expect(componentEnd).toBeGreaterThan(componentStart);
    expect(firstEarlyReturn).toBeGreaterThan(componentStart);
    expect(firstEarlyReturn).toBeLessThan(componentEnd);
  });

  it('所有 hook 调用都出现在第一个组件级早退之前', () => {
    const violations: string[] = [];
    for (let index = firstEarlyReturn; index < componentEnd; index += 1) {
      const line = lines[index];
      if (line.trim().startsWith('//')) continue;
      if (hookCall.test(line)) violations.push(`line ${index + 1}: ${line.trim()}`);
    }
    expect(violations).toEqual([]);
  });
});
