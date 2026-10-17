// BLOCK-200 P2 档位词表跨端对账：前端镜像（composer 用）与后端映射表（gateway 用）不得漂移，
// 且前端不得再长出第二份档位字面量副本。沿用 channels.js ↔ preload.js 的双向守护先例。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// CJS 单源表，只在测试里跨语言对账（生产构建不引 CJS）。
// @ts-expect-error 无声明文件；vitest 走 CJS 互操作可用
import * as rawReasoningDefaults from '../../../../core/packages/shared-config/reasoning-defaults.js';

// 无 .d.ts 的 CJS 模块：在测试边界显式收窄类型，而不是让整文件落在 error-typed 上
const { THINKING_LEVELS, DEFAULT_THINKING_LEVEL, ANTHROPIC_HIGH_BUDGET_TOKENS, DEFAULT_MAPPING } =
  rawReasoningDefaults as unknown as {
    THINKING_LEVELS: readonly string[];
    DEFAULT_THINKING_LEVEL: string;
    ANTHROPIC_HIGH_BUDGET_TOKENS: number;
    DEFAULT_MAPPING: Record<string, Record<string, string>>;
  };
import { THINKING_LEVELS as FRONTEND_LEVELS, DEFAULT_THINKING_LEVEL as FRONTEND_DEFAULT } from './thinkingLevel';

const COPILOT_ROOT = path.resolve(__dirname);

describe('推理档位词表跨端对账', () => {
  it('前端档位集合与默认档逐字等于后端单源表', () => {
    expect([...FRONTEND_LEVELS]).toEqual([...THINKING_LEVELS]);
    expect(FRONTEND_DEFAULT).toBe(DEFAULT_THINKING_LEVEL);
  });

  it('出厂映射表三协议三档齐备且默认档=none（不发参数=零行为变化）', () => {
    const protocols = Object.keys(DEFAULT_MAPPING);
    expect(protocols).toEqual(['openai-compatible', 'anthropic-messages', 'dashscope-native']);
    for (const protocol of protocols) {
      expect(Object.keys(DEFAULT_MAPPING[protocol]).sort()).toEqual([...THINKING_LEVELS].sort());
      expect(DEFAULT_MAPPING[protocol].standard).toBe('none');
    }
    expect(ANTHROPIC_HIGH_BUDGET_TOKENS).toBe(16000);
  });

  it('前端不再存在第二份档位字面量 union（副本一律收敛到 thinkingLevel.ts）', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules') continue;
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) continue;
        // 先剥注释再判：这条门管的是**类型声明里的第二份字面量**，注释里提到三档不该算副本
        const text = fs.readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .split('\n')
          .filter((line) => !line.trimStart().startsWith('//'))
          .join('\n');
        if (/'off'\s*\|\s*'standard'\s*\|\s*'high'/.test(text) && !full.endsWith(path.join('copilot', 'thinkingLevel.ts'))) {
          offenders.push(path.relative(COPILOT_ROOT, full));
        }
      }
    };
    walk(path.resolve(COPILOT_ROOT, '..'));
    expect(offenders, `发现第二份档位字面量副本：${offenders.join(', ')}`).toEqual([]);
  });
});
