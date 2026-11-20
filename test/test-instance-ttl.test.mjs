/**
 * S7/P2-2 测试实例 TTL 机械门禁 — HK-01 红绿先行（R2 清偿批）。
 *
 * 同类缺陷第二次出现（R2 评估：9223 测试实例遗留 30+ 分钟→9 小时；源码门禁
 * live-window-policy 只扫 PETRI_TEST_ONSCREEN 字面量，对「跑完忘 kill」是盲区）
 * → 按治理纪律转机械门禁：start-test-instance.sh 必须内置 TTL 看门狗
 * （超时自动 kill 9223 遗留实例 + 代币防误杀后启实例），且默认 TTL 有界。
 * 本测试扫描启动脚本源码（同 live-window-policy 的源码扫描门法）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'start-test-instance.sh');

test('TTL 看门狗已布防（超时自动 kill，不再依赖 agent 记忆）', () => {
  const s = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(s, /PETRI_TEST_TTL_S/, '必须有 TTL 环境变量入口（可覆盖、可默认）');
  assert.match(s, /ttl-watchdog/, '必须有看门狗日志指纹（事后可归因）');
  // 触发时按端口现查监听者再杀（不锚启动期 pid：重启后 pid 会漂移）
  assert.match(s, /iTCP:9223|netstat -ano.*9223/, '触发时必须按 9223 端口现查监听者');
  assert.match(s, /kill/, '触发动作必须是 kill');
});

test('代币防误杀：新实例启动后旧看门狗不得杀新实例', () => {
  const s = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(s, /\.petri-test-instance\.ttl/, '必须有代币标记文件');
  assert.match(s, /cur/, '触发时必须核对代币（标记已换代即退出）');
});

test('默认 TTL 有界（≤24h）且幂等可覆盖', () => {
  const s = fs.readFileSync(SCRIPT, 'utf8');
  const m = s.match(/PETRI_TEST_TTL_S:\s*-(\d+)/);
  assert.ok(m, '必须有默认值形态 ${PETRI_TEST_TTL_S:-N}');
  const ttl = Number(m[1]);
  assert.ok(ttl > 0 && ttl <= 86_400, `默认 TTL=${ttl}s 必须在 (0, 24h] 内`);
});
