#!/usr/bin/env node
'use strict';

/**
 * BLOCK-54 P4 模型侧实机驱动（真实 tool 面，不经 LLM）：
 *   直接调用 agent 循环同款 `tool_workspace_exec` / `tool_process_status` /
 *   `tool_process_stop`（createWorkspaceTools 导出与 agent 注册同源），在真实
 *   desktop workspace 上实跑子进程，验证 yield 中间档语义：
 *     1) 短命令 yield 预算内完成 → 完整结果、无 yielded
 *     2) 长命令 > yield_ms → { yielded: true, processId } 挂后台进程表
 *     3) process_status 轮询收尾 → 日志含完整输出、exitCode 0
 *     4) yield_ms 超范围钳制不报错
 *     5) max_output_tokens token 预算截断 + 诚实标记
 *   证据：acceptance/block-54/model-side-yield.json
 *
 * 与 agent-workspace-exec-yield.test.mjs 的差异：test 用 /tmp sandbox；本驱动
 * 用真实项目 workspace（desktop 仓库根）+ 真实 shell 时序，属 P4 实机证据。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-54');

const ctx = {
  projectId: 'p_block54_live',
  userId: 'u_owner',
  accessMode: 'full',
  conversationId: 'conv_block54_live',
};

const fakeDb = {
  getProject(projectId) {
    if (projectId !== ctx.projectId) return null;
    return { id: ctx.projectId, user_id: ctx.userId, status: 'active', workspace_path: ROOT };
  },
  getUserById(userId) {
    return { id: userId, role: 'user' };
  },
};

const { createWorkspaceTools } = require(ROOT + '/core/biof3-server/agent-tools/workspace-tools.js');
const tools = createWorkspaceTools({ dbProvider: () => fakeDb });
const t = {
  exec: tools.executeCommand,
  status: tools.processStatus,
  stop: tools.processStop,
};

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const results = { startedAt: new Date().toISOString(), workspace: ROOT, assertions: [] };
  const assert = (name, pass, detail) => {
    results.assertions.push({ name, pass: !!pass, detail: String(detail || '').slice(0, 300) });
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + String(detail).slice(0, 200) : ''}`);
  };
  const spawned = [];

  try {
    // 1) 短命令：预算内完成 → 完整结果无 yielded
    const short = await t.exec({ command: 'echo b54-yield-short-ok', yield_ms: 5000 }, ctx);
    assert(
      '短命令 yield 预算内完整返回（无 yielded 标记）',
      short.ok === true && short.yielded === undefined && short.exitCode === 0 && /b54-yield-short-ok/.test(short.stdout || ''),
      JSON.stringify({ ok: short.ok, yielded: short.yielded, exitCode: short.exitCode })
    );

    // 2) 长命令：yield_ms=1000 超时 → yielded + processId
    const long = await t.exec(
      { command: 'echo b54-yield-started && sleep 3 && echo b54-yield-done', yield_ms: 1000 },
      ctx
    );
    spawned.push(long.processId);
    assert(
      '长命令 1s 处交还控制权：yielded + processId 挂后台进程表',
      long.ok === true && long.yielded === true && !!long.processId,
      JSON.stringify({ ok: long.ok, yielded: long.yielded, processId: long.processId })
    );

    // 3) process_status 轮询收尾
    const statusRunning = await t.status({ processId: long.processId }, ctx);
    assert(
      'yield 后 process_status 可见该进程',
      statusRunning.ok === true && !!statusRunning.process,
      JSON.stringify(statusRunning.process || statusRunning).slice(0, 200)
    );
    let final = null;
    for (let i = 0; i < 20; i += 1) {
      const s = await t.status({ processId: long.processId, logTailBytes: 8192 }, ctx);
      const blob = JSON.stringify(s);
      if (blob.includes('b54-yield-done')) {
        final = s;
        break;
      }
      await delay(500);
    }
    const finalBlob = JSON.stringify(final);
    assert(
      '轮询收尾：命令真实退出且日志含完整输出（b54-yield-done）',
      !!final && finalBlob.includes('b54-yield-done'),
      finalBlob.slice(0, 200)
    );

    // 4) 超范围钳制：99999999 → 30000 上限，短命令不报错
    const clamp = await t.exec({ command: 'echo b54-clamp-ok', yield_ms: 99999999 }, ctx);
    assert(
      'yield_ms 超范围被钳制不报错（99999999 → 30s 上限）',
      clamp.ok === true && /b54-clamp-ok/.test(clamp.stdout || ''),
      JSON.stringify({ ok: clamp.ok })
    );

    // 5) token 预算截断 + 诚实标记
    const big = await t.exec({ command: 'seq 1 2000', yield_ms: 5000, max_output_tokens: 64 }, ctx);
    assert(
      '输出超 token 预算被截断且诚实标记',
      big.ok === true && /截断/.test(big.note || ''),
      String(big.note || '').slice(0, 200)
    );

    // 清理兜底
    for (const processId of spawned) {
      try {
        await t.stop({ processId }, ctx);
      } catch {}
    }
  } catch (e) {
    assert('驱动异常', false, e.message);
  }

  results.finishedAt = new Date().toISOString();
  results.allPass = results.assertions.every((a) => a.pass);
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'model-side-yield.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(`\n${results.allPass ? 'ALL PASS' : 'HAS FAILURES'} → acceptance/block-54/model-side-yield.json`);
  process.exit(results.allPass ? 0 : 1);
}

main();
