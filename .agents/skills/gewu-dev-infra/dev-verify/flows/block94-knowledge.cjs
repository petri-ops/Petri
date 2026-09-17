#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block94-knowledge — BLOCK-94 知识空间专业化整包实机。
 *
 * 复用 scripts/block94-knowledge-live.cjs（产品真实路径）：
 *   总览新契约（分页/失配统计/规模观测）/ 空间启用 / 真实 DashScope 嵌入摄取
 *   （文本 + 最小合法 PDF + 粘贴）/ 真实双通道检索 / docId 过滤 / 纯符号降级
 *   诚实化 / 预览 / 批量删除与逐文件拒绝 / 真实模型轮次 knowledge_citations
 *   事件 / CDP：/knowledge 面板 + 项目工作台摘要卡「知识溯源」节。
 * 证据：acceptance/block-94/block94-knowledge-live-live.json（脚本落盘，flow 断言 allPass）。
 *
 * 前置：dev 栈（vite 3000 + 后端 3001 + CDP 9222，栈须在 BLOCK-94 代码之后重启）
 * + DashScope 凭据 + 至少一个项目；core/** 变更后必须重启 dev 栈。
 */
const path = require('node:path');
const { spawn } = require('node:child_process');

module.exports = {
  id: 'block94-knowledge',
  description: 'BLOCK-94 知识空间实机：真实嵌入摄取/PDF/粘贴/双通道检索/过滤/预览/批量/真轮次知识溯源/面板+摘要卡（dev 栈）',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'block-94'),

  async run(ctx) {
    const { assert } = ctx;
    const script = path.join(process.cwd(), 'scripts', 'block94-knowledge-live.cjs');
    const { code, out } = await new Promise((resolve) => {
      const p = spawn(process.execPath, [script], { cwd: process.cwd(), env: process.env });
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { out += d; });
      p.on('close', (c) => resolve({ code: c, out }));
    });
    const allPass = /allPass=true/.test(out);
    assert('block94_knowledge_live_allPass', code === 0 && allPass, `exit=${code} ${out.slice(-600)}`);
  },
};
