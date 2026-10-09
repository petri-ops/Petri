// HK-01 红绿先行 — 锁住两处终端通道 SSH argv 含保活参数契约。
//
// 背景（2026-10-09 用户反馈「格物里的 SSH 远程连接经常断，又自动恢复」）：
//   任务通道（ssh-multiplexer.js）有 ServerAliveInterval=15 + CountMax=2（UI-397），
//   但终端通道（src/ipc/terminal.js:220 + core/biof3-server/federation-terminal.js:104）
//   **零保活**——三层链路（Windows→ECS ProxyJump→frps 隧道→dell sshd）任一环
//   NAT/防火墙空闲超时都会静默掐掉无心跳的终端连接，下次敲键盘才发现死了
//   → 前端自动重连 = 用户感知的「又自动恢复」。
//
// 本测试用源码字面量断言锁住保活参数：两处 SSH argv 必须含
//   ServerAliveInterval=15（15s 心跳）+ ServerAliveCountMax=4（连续 4 次
//   无响应判死 = 60s 判死窗口；终端交互式通道比任务通道（CountMax=2）多
//   一倍窗口，避免偶发抖动误杀交互会话）。

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = process.env.BIOF3_PROJECT_ROOT || join(__dirname, '..');

const TERMINAL_JS = join(REPO_ROOT, 'src', 'ipc', 'terminal.js');
const FEDERATION_TERMINAL_JS = join(REPO_ROOT, 'core', 'biof3-server', 'federation-terminal.js');

// 终端通道判死窗口设计：60s（vs 任务通道 30s）——交互式 ssh -tt 通道
// 断开恢复代价高（用户感知强），多给一倍抖动容忍窗口。
const KEEPALIVE_INTERVAL = 'ServerAliveInterval=15';
const KEEPALIVE_COUNTMAX = 'ServerAliveCountMax=4';

describe('BLOCK-154 终端 SSH 保活契约（HK-01）', () => {
  it('src/ipc/terminal.js 的 SSH argv 含 15s 心跳 + 4 次判死保活参数', () => {
    const src = readFileSync(TERMINAL_JS, 'utf8');
    // 锁住 sshArgv 字面量（不引用 ssh-multiplexer 常量——桌面壳不应跨层依赖 core）。
    assert.ok(src.includes(KEEPALIVE_INTERVAL), 'terminal.js 缺 ServerAliveInterval=15');
    assert.ok(src.includes(KEEPALIVE_COUNTMAX), 'terminal.js 缺 ServerAliveCountMax=4');
  });

  it('core/biof3-server/federation-terminal.js 的 SSH argv 含 15s 心跳 + 4 次判死保活参数', () => {
    const src = readFileSync(FEDERATION_TERMINAL_JS, 'utf8');
    assert.ok(src.includes(KEEPALIVE_INTERVAL), 'federation-terminal.js 缺 ServerAliveInterval=15');
    assert.ok(src.includes(KEEPALIVE_COUNTMAX), 'federation-terminal.js 缺 ServerAliveCountMax=4');
  });

  it('两处 argv 仍含 ConnectTimeout=10（建连阶段超时不变）', () => {
    const t = readFileSync(TERMINAL_JS, 'utf8');
    const f = readFileSync(FEDERATION_TERMINAL_JS, 'utf8');
    assert.ok(t.includes('ConnectTimeout=10'), 'terminal.js 缺 ConnectTimeout=10');
    assert.ok(f.includes('ConnectTimeout=10'), 'federation-terminal.js 缺 ConnectTimeout=10');
  });
});
