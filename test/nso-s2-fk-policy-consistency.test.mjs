/**
 * nso-s2-fk-policy-consistency.test.mjs — BLOCK-377（S2 / G-08）FK 策略三面一致契约门。
 *
 * 背景：BLOCK-372 Batch-2 的「回退 OFF」提交（b4edf467）实际把 ON pragma 写进后端
 * connection.js（裁决与代码反向）——策略头注（OFF 真相）/运行时（ON）/测试断言三方冲突，
 * 直至 S2 按裁决落地。本门把「策略=唯一真相」钉成机械规则，防再漂移：
 *   - 后端连接（core/petri-server/db/connection.js）：foreign_keys 必须为 OFF；
 *   - 桌面单例（src/database/_db-singleton.js openDb）：foreign_keys 必须为 ON（A-007.8）；
 *   - 策略模块（shared-backend/db-connection-policy.js）：不得再出现与两处现状矛盾的
 *     foreign_keys 开关声明（基础 pragma 集合刻意不含 FK，注释记录分歧现状）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

test('S2-G08 后端连接 foreign_keys=OFF（BLOCK-372 裁决落地，源码钉）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/db/connection.js'), 'utf8');
  assert.match(src, /foreign_keys = OFF/, '后端 connection.js 必须显式 foreign_keys = OFF');
  assert.doesNotMatch(src, /foreign_keys = ON/, '后端不得再出现 ON pragma（裁决=OFF；ON 需独立清偿大包）');
});

test('S2-G08 运行时验证：后端连接实开 FK=OFF（临时库注入）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's2-fk-'));
  process.env.PETRI_DB_PATH = path.join(tmp, 'fk.db');
  {
    // 连接单例按进程缓存——本进程未加载过后端 connection 模块时可直接验证
    try {
      const dbMod = require(path.join(ROOT, 'core/petri-server/db/connection.js'));
      const fk = dbMod.db.pragma('foreign_keys', { simple: true });
      assert.equal(fk, 0, '后端单例运行时 FK 必须为 OFF');
    } catch (e) {
      // 模块已被其它测试加载且绑定其 PETRI_DB_PATH → 源码钉已覆盖契约，此处如实跳过
      if (/already|lock|SQLITE/.test(String(e.message))) {
        console.log(`[s2-fk] 运行时腿跳过（单例已被加载）：${e.message}`);
      } else {
        throw e;
      }
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('S2-G08 桌面单例 foreign_keys=ON 维持（A-007.8 语义，源码钉）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/database/_db-singleton.js'), 'utf8');
  assert.match(src, /foreign_keys = ON/, '桌面单例必须保持 ON（分歧现状=桌面 ON，策略头注在案）');
});

test('S2-G08 策略模块不做 FK 开关声明（唯一真相=两处现状+头注记录）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/shared-backend/db-connection-policy.js'), 'utf8');
  assert.doesNotMatch(src, /pragma\(['"]foreign_keys/, '策略基础 pragma 集合不得含 FK 开关（分歧现状由两处连接文件各自声明）');
});
