#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block99-knowledge-multispace — BLOCK-99 知识空间多空间版整包实机。
 *
 * 复用 scripts/block99-console-live.cjs（产品真实路径）：
 *   G4 会话台真轮次工具链（toolSubset=knowledge-console 只下发 knowledge 白名单）
 *   / D4 破坏性确认门两腿（首调出影响面+一次性 confirmToken → 用户确认消息 →
 *   凭 token 执行级联删除）/ 绑定链（绑定→删空间 FK CASCADE 回落默认）
 *   / CDP 测试实例 UI 走查（/knowledge 双栏挂载 + 会话台经 UI 输入真轮次 + 截图）。
 * 证据：acceptance/block-99/block99-console-live.json + block99-console-ui.png
 * （脚本落盘，flow 断言 allPass）。
 *
 * 前置：dev 栈（vite 3000 + 后端 3001，core/** 变更后必须重启）
 * + chat 模型凭据 + CDP 测试实例（bash scripts/start-test-instance.sh）。
 */
const path = require('node:path');
const { spawn } = require('node:child_process');

module.exports = {
  id: 'block99-knowledge-multispace',
  description: 'BLOCK-99 知识空间多空间实机：会话台真轮次工具链/D4 确认门两腿/绑定链 CASCADE/CDP UI 走查（dev 栈+测试实例）',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'block-99'),

  async run(ctx) {
    const { assert } = ctx;
    const script = path.join(process.cwd(), 'scripts', 'block99-console-live.cjs');
    const { code, out } = await new Promise((resolve) => {
      const p = spawn(process.execPath, [script], { cwd: process.cwd(), env: process.env });
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { out += d; });
      p.on('close', (c) => resolve({ code: c, out }));
    });
    const allPass = /allPass=true/.test(out);
    assert('block99_console_live_allPass', code === 0 && allPass, `exit=${code} ${out.slice(-600)}`);
  },
};
