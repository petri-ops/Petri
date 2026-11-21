/**
 * P6 driver iframe 探针升级小票 — HK-01 契约（R2 清偿批）。
 *
 * P6-TABLE-LOAD 三轮账定位的卡点：table_load 阶段 pack iframe（petri-pack://go-kegg/…）
 * 停在 loading（宿主未收到 petri:ready），现有探针只扫主 frame——iframe 内 URL/加载态/
 * console 不可见，无法归因。本票给 driver 加 inspectPackSurface（frameTree+跨进程
 * target 枚举+isolated world 读数，与 inspectReport 同构），并在 table_load 失败路径
 * 上自动落证（driver-result.json 新增 packSurface 段）。
 *
 * 本文件只测**纯函数/源码契约**（不跑 Electron）：探针源在 driver 源码中以独立导出函数
 * 存在、table_load 失败路径调用它、读数形状含归因所需字段。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRIVER = path.join(ROOT, 'scripts', 'g0-rs-p6-electron-pressure-driver.cjs');
const src = () => fs.readFileSync(DRIVER, 'utf8');

test('探针函数 inspectPackSurface 存在且可独立评估（纯结构，不触网）', () => {
  const s = src();
  assert.match(s, /function evaluatePackSurfaceProbe\(/, '必须有可测纯函数 evaluatePackSurfaceProbe（CJS 内部函数）');
  assert.match(s, /petri-pack:/, '探针须识别 petri-pack:// frame');
  assert.match(s, /__petriSurfaceReady/, '探针须读 iframe 内 ready 握手标记（宿主侧协议词 petri:ready 不经 driver）');
});

test('读数形状：iframe 枚举含 url/ready/console 尾与归因字段', () => {
  const s = src();
  for (const field of ['frames', 'packUrl', 'frameUrl', 'readySignal', 'consoleTail', 'verdict']) {
    assert.ok(
      new RegExp(`["']?(?:${field})["']?\\s*[:=]`).test(s) || s.includes(field),
      `探针读数缺字段 ${field}`,
    );
  }
});

test('table_load 失败路径自动落证（inspectPackSurface 接入 fail 诊断）', () => {
  const s = src();
  assert.match(
    s,
    /inspectPackSurface\s*\(/,
    'table_load 失败诊断须调用 inspectPackSurface',
  );
});
