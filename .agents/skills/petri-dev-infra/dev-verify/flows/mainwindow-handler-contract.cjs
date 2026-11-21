#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：mainwindow-handler-contract — 用户主窗（9222）IPC handler 只读契约探活。
 *
 * 背景（EVO-4 用户实测 bug）：主进程代码（IPC handler）改动后必须重启 Electron 主窗才生效；
 * 只重启后端不够。此前实机腿只连 9223 测试实例（新进程），漏检主窗旧进程里驻留的旧 handler
 * （直开 better-sqlite3 → ABI 不匹配红字）。本 flow 用只读方式在**主窗** invoke 指定 handler，
 * 断言返回事而不是错误，作为主进程改动收口的防复发门禁。
 *
 * 红线：只读 invoke，不导航、不点击、不改任何状态（遵守「探针禁导航用户窗口」）；
 * 只连 9222（用户主窗），不连 9223；本 flow 不写任何 UI 台账 verified（观感零代签）。
 *
 * 用法：npm run verify -- mainwindow-handler-contract
 * 前置：用户主窗在跑且已加载当前主进程代码（主进程改动后需先重启 Electron）。
 */
const path = require('node:path');
const lib = require('../lib.cjs');

// env 调用时读取（BLOCK-375 顶层固化棘轮）
const CHANNEL = () => process.env.HANDLER_CONTRACT_CHANNEL || 'lessonEvidence';

module.exports = {
  id: 'mainwindow-handler-contract',
  description: '用户主窗（9222）IPC handler 只读契约探活：invoke data.lessonEvidence 断言无 ABI 错误（EVO-4 防复发）',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'evo-4'),

  async run({ assert, timeoutMs }) {
    const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
    const target = list.find((t) => t.type === 'page' && /localhost:3000/.test(t.url));
    assert('M1_main_window_target_found', !!target, '9222 主窗 page target');
    if (!target) return false;

    const client = new (require(path.join(process.cwd(), 'scripts/g0-rs-p7-cdp.cjs')).CdpClient)(target.webSocketDebuggerUrl);
    await client.connect(timeoutMs || 30_000);
    try {
      const r = await client.send('Runtime.evaluate', {
        expression: `(async()=>{
          const fn = window.petriDesktop?.data?.${CHANNEL};
          if (!fn) return JSON.stringify({ok:false,error:'bridge_missing'});
          const v = await fn();
          return JSON.stringify({ok:v.ok,error:v.error||null,lessons:(v.lessons||[]).length,trend:(v.incidentTrend||[]).length,reason:v.reason||null});
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      const raw = r?.result?.value;
      const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
      assert('M2_handler_bridge_present', v && v.error !== 'bridge_missing', 'preload 桥在场');
      assert('M3_handler_no_abi_error',
        v && v.ok === true && !/better_sqlite3|NODE_MODULE_VERSION|compiled against/i.test(v.error || ''),
        JSON.stringify(v));
      assert('M4_handler_payload_shape',
        v && typeof v.ok === 'boolean'
        && typeof v.lessons === 'number' && typeof v.trend === 'number',
        `ok=${v?.ok} lessons=${v?.lessons} trend=${v?.trend}`);
    } finally {
      client.close();
    }
    return true;
  },
};
