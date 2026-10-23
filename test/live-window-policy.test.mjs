import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['scripts', path.join('.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'flows')];

/**
 * 用户裁决（2026-10-17「这种开发模式就不要打开窗口了 目前打开窗口 占用屏幕」；
 * 2026-10-23 复发追问）：Agent 的实机脚本**不得**把测试窗口摆到屏幕上。
 * 该坑两次复发（BLOCK-247/248 照搬 PETRI_TEST_ONSCREEN=1）——固化成门禁：
 * 脚本里出现 PETRI_TEST_ONSCREEN=1 / '1' 即红。人要看测试请手动跑
 * `bash scripts/start-test-instance.sh --onscreen`（启动器是唯一合法入口）。
 */
test('agent 实机脚本不得设置 PETRI_TEST_ONSCREEN（屏幕不留测试窗）', () => {
  const offenders = [];
  for (const dir of SCAN_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) {
      if (!/\.(mjs|cjs|js)$/.test(name)) continue;
      const text = fs.readFileSync(path.join(abs, name), 'utf8');
      if (/PETRI_TEST_ONSCREEN\s*[:=]\s*['"]?1/.test(text)) {
        offenders.push(path.join(dir, name).replaceAll('\\', '/'));
      }
    }
  }
  assert.deepEqual(offenders, [], `禁止在 Agent 实机脚本里设置 PETRI_TEST_ONSCREEN=1：${offenders.join(', ')}`);
});
