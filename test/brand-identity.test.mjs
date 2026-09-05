'use strict';

/**
 * BLOCK-61 P1 — 品牌身份契约。
 *
 * 1. 双端镜像一致：src/main/brand.js 与 frontend/src/lib/brand.ts 的
 *    常量逐字段相等（渲染进程不能 require 主进程模块，靠本测试锁）。
 * 2. 禁止裸写品牌字面量：src/ 与 frontend/src/ 的代码中，历史品牌名
 *    只允许出现在品牌模块的 LEGACY 常量与显式白名单里。此后任何再改名
 *    = 改两个品牌模块 + 全仓机械同步（sed），本测试防新字面量回流。
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const { BRAND } = require('../src/main/brand.js');

describe('品牌身份契约（BLOCK-61）', () => {
  test('主进程品牌模块常量符合定名裁决', () => {
    assert.equal(BRAND.APP_NAME, 'Gewu');
    assert.equal(BRAND.APP_NAME_ZH, '格物');
    assert.equal(BRAND.LEGACY_APP_NAME, 'BioF3');
    assert.equal(BRAND.LOCAL_DIR_NAME, 'Gewu-Local');
    assert.equal(BRAND.LEGACY_LOCAL_DIR_NAME, 'BioF3-Local');
    assert.ok(Object.isFrozen(BRAND), 'BRAND 必须冻结');
  });

  test('渲染进程镜像与主进程权威逐字段一致', () => {
    const ts = fs.readFileSync(
      path.join(ROOT, 'frontend', 'src', 'lib', 'brand.ts'),
      'utf8',
    );
    for (const [key, value] of Object.entries(BRAND)) {
      const match = ts.match(new RegExp(`${key}:\\s*'([^']*)'`));
      assert.ok(match, `镜像缺少 ${key}`);
      assert.equal(match[1], value, `镜像 ${key} 不一致`);
    }
  });

  test('历史品牌名不得裸写在业务代码中（白名单外）', () => {
    // 白名单：品牌模块自身（LEGACY 常量）+ 协议命名空间 + 兼容别名
    const ALLOWLIST_FILES = new Set([
      'src/main/brand.js',
      'frontend/src/lib/brand.ts',
    ]);
    // 这些子串是协议/兼容标识（plan §4），含品牌历史词但不是品牌展示面
    const ALLOWED_SUBSTRINGS = [
      'biof3Desktop',      // preload 旧桥别名（兼容保留）
      'core/biof3-server', // 后端协议路径
      'biof3-server',      // 同上（路径分段出现）
      '.biof3-dev-user-data', // 用户数据目录（数据连续性）
      'biof3-r-toolchain', // R 预编译包插件 id（插件生态标识）
      'biof3-mcp',         // MCP server 协议名（P2 改为 gewu-mcp 后应消失——临时白名单）
      'biof3_agent_task',  // 会话内 localStorage 旧 key（读旧兼容）
      'window.biof3?',     // biof3 agent-workbench 旗标桥（独立小桥，别名保留）
    ];

    const scanDirs = ['src', 'frontend/src'];
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'dist') continue;
          walk(full);
          continue;
        }
        if (!/\.(js|mjs|cjs|ts|tsx|css|html)$/.test(entry.name)) continue;
        const rel = path.relative(ROOT, full).split(path.sep).join('/');
        if (ALLOWLIST_FILES.has(rel)) return;
        const text = fs.readFileSync(full, 'utf8');
        if (!/biof3/i.test(text)) return;
        for (const line of text.split('\n')) {
          if (!/biof3/i.test(line)) continue;
          // 注释行放行（历史说明允许提及旧名）
          const trimmed = line.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
          if (ALLOWED_SUBSTRINGS.some((s) => line.includes(s))) continue;
          offenders.push(`${rel}: ${trimmed.slice(0, 120)}`);
        }
      }
    };
    for (const dir of scanDirs) walk(path.join(ROOT, dir));
    assert.deepEqual(offenders, []);
  });
});
