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

// ── P6 OOP iframe 深探（小票 2026-11-22）────────────────────────────────────
// 裁决 A（supportFetchAPI+corsEnabled）已试无效；本票用 CDP
// Target.attachToTarget({targetId, flatten:true}) 挂进跨进程 petri-pack iframe target，
// 读 document 加载态/执行上下文/console/ready 握手，坐实真断点在导航层还是脚本层。

test('OOP 深探：attachToTarget({flatten:true}) 挂跨进程 iframe target', () => {
  const s = src();
  assert.match(s, /async function attachOopPackFrame\(/, '须有独立 OOP attach 深探函数');
  assert.match(s, /Target\.attachToTarget/, '须用 Target.attachToTarget 挂跨进程 iframe');
  assert.match(s, /flatten:\s*true/, 'attachToTarget 须 flatten:true 拿独立 sessionId');
  assert.match(s, /sessionId/, 'Runtime.evaluate 须带 attached sessionId');
});

test('OOP 深探读 4 项：document 加载态 / 执行上下文可达 / console / ready 握手', () => {
  const s = src();
  for (const token of [
    'document.readyState', 'location.href', 'document.title',
    'hasBioTable', 'contextAvailable', 'Log.enable', 'consoleAPICalled',
    'exceptionThrown', '__petriSurfaceReady', 'petri:ready',
  ]) {
    assert.ok(s.includes(token), `OOP 深探读数缺 ${token}`);
  }
});

test('OOP 深探纯函数归因 + verdict 分支 + driver-result 落证', () => {
  const s = src();
  assert.match(s, /function evaluateOopProbe\(/, '须有可测纯函数 evaluateOopProbe');
  for (const v of [
    'oop_no_iframe_target', 'oop_pack_target_absent', 'oop_attach_failed', 'oop_context_unavailable',
    'oop_document_replaced', 'oop_document_loading',
    'oop_document_present_ready_missing', 'oop_document_present_ready_sent',
  ]) {
    assert.ok(s.includes(v), `OOP verdict 缺 ${v}`);
  }
  assert.ok(
    /oopProbe/.test(s) && /packSurfaceProbe/.test(s),
    '深探读数须并入 packSurfaceProbe 段落落证',
  );
});

test('OOP 判据树纯函数行为：无 target / 无 pack target / ready 握手三分支', () => {
  const s = src();
  const start = s.indexOf('function evaluateOopProbe(input) {');
  assert.ok(start >= 0, '须能定位 evaluateOopProbe 定义');
  // 自包含纯函数：从定义起按大括号配平截取函数体。
  let depth = 0;
  let end = -1;
  for (let i = s.indexOf('{', start); i < s.length; i += 1) {
    if (s[i] === '{') depth += 1;
    else if (s[i] === '}') { depth -= 1; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > start, '函数体须可完整截取');
  const evaluateOopProbe = new Function(`return (${s.slice(start, end)})`)();
  assert.equal(evaluateOopProbe({ frames: [], iframeTargets: [] }).verdict, 'oop_no_iframe_target');
  assert.equal(
    evaluateOopProbe({ frames: [], iframeTargets: [{ type: 'iframe', url: 'about:blank' }] }).verdict,
    'oop_pack_target_absent',
  );
  assert.equal(
    evaluateOopProbe({
      frames: [{ attached: true, contextAvailable: true, documentTitle: '生信主结果', readyState: 'complete', hasBioTable: true }],
      iframeTargets: [{ type: 'iframe', url: 'petri-pack://petri-pack-bio/ui/result.html' }],
      hostMessages: [{ type: 'petri:ready' }],
    }).verdict,
    'oop_document_present_ready_sent',
  );
  assert.equal(
    evaluateOopProbe({
      frames: [{ attached: true, contextAvailable: true, documentTitle: '生信主结果', readyState: 'complete', hasBioTable: true }],
      iframeTargets: [{ type: 'iframe', url: 'petri-pack://petri-pack-bio/ui/result.html' }],
      hostMessages: [],
    }).verdict,
    'oop_document_present_ready_missing',
  );
});
