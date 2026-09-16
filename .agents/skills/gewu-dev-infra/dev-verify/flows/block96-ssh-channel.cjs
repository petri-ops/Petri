#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block96-ssh-channel — BLOCK-96 SSH 通道效率与稳定性实机。
 *
 * 复用 scripts/block96-ssh-channel-live.cjs（产品真实路径：gateway + mux + agent
 * 自动部署）对真节点取证：
 *   首连计时 / 恶意文件名 NUL 协议往返 / fs_list 500 文件计时与基线对照 /
 *   分页契约 / mux 写列一致 / exec_bg pidfile 身份 / ps_pid starttime 校验 /
 *   kill_pid 组杀 / exec 超时孤儿清零。
 * 证据：acceptance/block-96/block96-p1-live.json（脚本落盘，flow 断言 allPass）。
 *
 * 前置：目标节点 ssh 免密可达（BLOCK96_SSH_ALIAS 指定别名，缺省 wsl）。
 * 本 flow 不依赖 dev Electron 栈。
 */
const path = require('node:path');
const { spawn } = require('node:child_process');

module.exports = {
  id: 'block96-ssh-channel',
  description: 'BLOCK-96 SSH 通道实机：首连计时/恶意文件名 NUL 协议/分页/进程面孤儿清零（真节点）',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'block-96'),

  async run(ctx) {
    const { assert } = ctx;
    const alias = process.env.BLOCK96_SSH_ALIAS || 'wsl';
    const script = path.join(process.cwd(), 'scripts', 'block96-ssh-channel-live.cjs');
    // spawn+await（execFileSync 的 Windows spawnSync timeout 语义不可靠）
    const { code, out } = await new Promise((resolve) => {
      const child = spawn(process.execPath, [script, '--alias', alias], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (c) => { out += c; });
      child.stderr.on('data', (c) => { out += c; });
      const timer = setTimeout(() => { child.kill(); resolve({ code: -1, out: `${out}\n[block96 flow] timeout 240s` }); }, 240000);
      child.on('exit', (exitCode) => { clearTimeout(timer); resolve({ code: exitCode, out }); });
    });
    assert('live_probe_executed', code === 0, out.trim().split('\n').slice(-3).join(' | ').slice(0, 300));
    let evidence = null;
    try { evidence = require(path.join(process.cwd(), 'acceptance', 'block-96', 'block96-p1-live.json')); } catch { /* 读不到即断言失败 */ }
    assert('live_probe_all_pass', Boolean(evidence && evidence.allPass === true), evidence ? evidence.checks.map((c) => `${c.name}:${c.passed ? 'ok' : 'FAIL'}`).join(' ') : 'evidence missing');
    assert('baseline_compare_recorded', Boolean(evidence && evidence.baseline && evidence.baseline.firstConnectBeforeMs), evidence && evidence.baseline ? `首连基线 ${evidence.baseline.firstConnectBeforeMs}ms` : 'missing');
  },
};
