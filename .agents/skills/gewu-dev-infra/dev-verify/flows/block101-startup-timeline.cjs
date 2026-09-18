#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block101-startup-timeline — BLOCK-101 P0 启动 timeline 采样。
 *
 * 复用 scripts/block101-startup-timeline-live.cjs（产品真实路径）：
 * D1 四段打点（mainReady/windowShown/didFinishLoad + 渲染层 firstPaint/dataReady）
 * 在真实冷启动链上采样 N 次，中位数/极值落 acceptance/block-101/。
 * 前置：主 dev 栈（后端 :3001）；测试实例生命周期由脚本自管。
 */
const path = require('node:path');
const { spawn } = require('node:child_process');

module.exports = {
  id: 'block101-startup-timeline',
  description: 'BLOCK-101 启动性能 P0：D1 四段 timeline 真实冷启动采样（dev 栈+自管测试实例）',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'block-101'),

  async run(ctx) {
    const { assert } = ctx;
    const script = path.join(process.cwd(), 'scripts', 'block101-startup-timeline-live.cjs');
    const { code, out } = await new Promise((resolve) => {
      const p = spawn(process.execPath, [script], { cwd: process.cwd(), env: process.env });
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { out += d; });
      p.on('close', (c) => resolve({ code: c, out }));
    });
    const allPass = /allPass=true/.test(out);
    assert('block101_startup_timeline_allPass', code === 0 && allPass, `exit=${code} ${out.slice(-600)}`);
  },
};
