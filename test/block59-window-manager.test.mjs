'use strict';

/**
 * BLOCK-59 P0 — 窗口管理器核心单测（plan §7 P0 验收门）。
 *
 * 覆盖三类契约：
 *  1. 状态机全转移路径：docked→popped→railed→closed 三活态一终态 +
 *     popped→docked 收回 + 全部非法转移拒绝。
 *  2. 路由白名单 fail-closed：未知类型 / 内部类型 / 非法键全部拒绝，
 *     只有注册表声明的路由模式可被构建（plan §4.2 裁决 5）。
 *  3. geometry 位置记忆：主进程持有 + 持久化 round-trip + 副屏失效
 *     回落主屏（plan §4.2 裁决 4）。
 *
 * 另含适配器/预加载的静态契约锁（文件形态，防止 IPC 面漂移）。
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  createWindowManagerCore,
  validateContent,
  buildRouteForId,
  isValidGeometry,
  clampBoundsToWorkArea,
  MAX_POPPED_WINDOWS,
} = require('../src/main/_window-manager.js');

const DISPLAYS = [
  {
    id: 1,
    bounds: { x: 0, y: 0, width: 1440, height: 900 },
    workArea: { x: 0, y: 0, width: 1440, height: 860 },
  },
  {
    id: 2,
    bounds: { x: 1440, y: 0, width: 1920, height: 1080 },
    workArea: { x: 1440, y: 0, width: 1920, height: 1040 },
  },
];

/** Deterministic clock: each `now()` call advances 1ms. */
function makeClock(start = 1000) {
  let t = start;
  return () => ++t;
}

function makeCore(overrides = {}) {
  return createWindowManagerCore({ now: makeClock(), ...overrides });
}

// ── 1. 状态机全转移路径 ─────────────────────────────────────────

describe('状态机：三活态一终态', () => {
  test('docked → popped（首次弹出 = created）', () => {
    const core = makeCore();
    const r = core.popOut({ type: 'terminal', key: 'art_1' });
    assert.equal(r.ok, true);
    assert.equal(r.action, 'created');
    assert.equal(r.id, 'terminal:art_1');
    const entry = core.getSnapshot().entries.find((e) => e.id === 'terminal:art_1');
    assert.equal(entry.state, 'popped');
  });

  test('同内容禁双开：popped 再弹出 = focused（不建第二窗）', () => {
    const core = makeCore();
    core.popOut({ type: 'terminal', key: 'art_1' });
    const r2 = core.popOut({ type: 'terminal', key: 'art_1' });
    assert.equal(r2.ok, true);
    assert.equal(r2.action, 'focused');
    assert.equal(core.getSnapshot().entries.length, 1, '注册表不产生第二条目');
  });

  test('railed 内容再弹出 = restored（轨道恢复）', () => {
    const core = makeCore();
    core.popOut({ type: 'terminal', key: 'default' });
    core.minimizeToRail('terminal:default');
    const r = core.popOut({ type: 'terminal', key: 'default' });
    assert.equal(r.ok, true);
    assert.equal(r.action, 'restored');
    const entry = core.getSnapshot().entries.find((e) => e.id === 'terminal:default');
    assert.equal(entry.state, 'popped');
    assert.equal(entry.railedAt, null);
  });

  test('× 语义：popped → railed（降格不是销毁）', () => {
    const core = makeCore();
    core.popOut({ type: 'terminal', key: 'art_1' });
    const r = core.minimizeToRail('terminal:art_1');
    assert.equal(r.ok, true);
    assert.equal(r.state, 'railed');
    const entry = core.getSnapshot().entries.find((e) => e.id === 'terminal:art_1');
    assert.equal(entry.state, 'railed', '条目仍在注册表（保活）');
  });

  test('railed → popped：restoreFromRail 回记忆态', () => {
    const core = makeCore();
    core.popOut({ type: 'terminal', key: 'art_1' });
    core.minimizeToRail('terminal:art_1');
    const r = core.restoreFromRail('terminal:art_1');
    assert.equal(r.ok, true);
    assert.equal(r.state, 'popped');
  });

  test('popped → docked：returnToDock 收回（状态零丢失由渲染层持有）', () => {
    const core = makeCore();
    core.popOut({ type: 'terminal', key: 'art_1' });
    const r = core.returnToDock('terminal:art_1');
    assert.equal(r.ok, true);
    assert.equal(r.state, 'docked');
    const entry = core.getSnapshot().entries.find((e) => e.id === 'terminal:art_1');
    assert.equal(entry.state, 'docked', '条目保留（docked）');
  });

  test('railed → closed：remove 是唯一销毁路径，条目终结', () => {
    const core = makeCore();
    core.popOut({ type: 'terminal', key: 'art_1' });
    core.minimizeToRail('terminal:art_1');
    const r = core.remove('terminal:art_1');
    assert.equal(r.ok, true);
    assert.equal(r.state, 'closed');
    assert.equal(core.getSnapshot().entries.length, 0, '终态后条目离开注册表');
  });

  test('非法转移全部拒绝：remove 仅限 railed；restore/return 仅限对应态', () => {
    const core = makeCore();
    core.popOut({ type: 'terminal', key: 'art_1' });
    // popped 态：remove / restore 非法
    assert.equal(core.remove('terminal:art_1').ok, false, 'popped 不可直接销毁（契约）');
    assert.equal(core.restoreFromRail('terminal:art_1').ok, false);
    core.minimizeToRail('terminal:art_1');
    // railed 态：returnToDock / 二次 minimize 非法
    assert.equal(core.returnToDock('terminal:art_1').ok, false);
    assert.equal(core.minimizeToRail('terminal:art_1').ok, false);
    // docked 态：minimize / remove / restore 非法
    core.restoreFromRail('terminal:art_1');
    core.returnToDock('terminal:art_1');
    assert.equal(core.minimizeToRail('terminal:art_1').ok, false);
    assert.equal(core.remove('terminal:art_1').ok, false);
    assert.equal(core.restoreFromRail('terminal:art_1').ok, false);
    // 未知 id
    assert.equal(core.minimizeToRail('terminal:nope').ok, false);
    assert.equal(core.remove('terminal:nope').ok, false);
  });
});

describe('弹出上限 ≤4 与自动降格', () => {
  test(`第 ${MAX_POPPED_WINDOWS + 1} 个弹出自动降格最老的`, () => {
    const core = makeCore();
    for (let i = 1; i <= MAX_POPPED_WINDOWS; i++) {
      core.popOut({ type: 'terminal', key: `art_${i}` });
    }
    assert.equal(core.getSnapshot().entries.filter((e) => e.state === 'popped').length, MAX_POPPED_WINDOWS);
    const r = core.popOut({ type: 'terminal', key: 'art_5' });
    assert.equal(r.ok, true);
    assert.equal(r.action, 'created');
    assert.equal(r.autoDemoted, 'terminal:art_1', '最老的弹出窗被自动降入轨道');
    const states = Object.fromEntries(
      core.getSnapshot().entries.map((e) => [e.id, e.state]),
    );
    assert.equal(states['terminal:art_1'], 'railed', '被降格窗口保活在轨道');
    assert.equal(
      core.getSnapshot().entries.filter((e) => e.state === 'popped').length,
      MAX_POPPED_WINDOWS,
      'popped 数不超上限',
    );
  });

  test('restore 在满员时同样自动降格最老', () => {
    const core = makeCore();
    for (let i = 1; i <= MAX_POPPED_WINDOWS; i++) {
      core.popOut({ type: 'terminal', key: `art_${i}` });
    }
    core.minimizeToRail('terminal:art_1');
    // 此刻 popped = 3；再弹 2 个补满 4，然后 restore art_1
    core.popOut({ type: 'terminal', key: 'art_6' });
    const r = core.popOut({ type: 'terminal', key: 'art_1' });
    assert.equal(r.ok, true);
    assert.equal(r.action, 'restored');
    assert.ok(r.autoDemoted, '满员 restore 触发自动降格');
    assert.equal(
      core.getSnapshot().entries.filter((e) => e.state === 'popped').length,
      MAX_POPPED_WINDOWS,
    );
  });
});

// ── 2. 路由白名单 fail-closed ───────────────────────────────────

describe('路由白名单（fail-closed）', () => {
  test('注册表内类型 + 合法键通过；UI-385 退役类型 fail-closed', () => {
    assert.equal(validateContent({ type: 'terminal', key: 'art_1' }).ok, true);
    assert.equal(validateContent({ type: 'terminal', key: 'default' }).ok, true);
    assert.equal(validateContent({ type: 'command-center' }).ok, true);
    // UI-385 — result/agent 独立窗退役：类型已从白名单移除（路由 fail-closed，
    // 结果/子智能体详情统一由主窗右栏承载）。
    const retired = validateContent({ type: 'result', key: 'art_1' });
    assert.equal(retired.ok, false);
    assert.equal(retired.code, 'route_not_allowed');
    const retiredAgent = validateContent({ type: 'agent', key: 'task_9f' });
    assert.equal(retiredAgent.ok, false);
    assert.equal(retiredAgent.code, 'route_not_allowed');
  });

  test('未知类型拒绝', () => {
    const v = validateContent({ type: 'settings', key: 'x' });
    assert.equal(v.ok, false);
    assert.equal(v.code, 'route_not_allowed');
  });

  test('内部类型（rail 容器）不对外暴露', () => {
    const v = validateContent({ type: 'rail' });
    assert.equal(v.ok, false);
    assert.equal(v.code, 'route_not_allowed');
  });

  test('单例不接受内容键', () => {
    const v = validateContent({ type: 'command-center', key: 'x' });
    assert.equal(v.ok, false);
    assert.equal(v.code, 'invalid_key');
  });

  test('非法键 fail-closed：路径穿越 / 斜杠 / 空 / 超长 / 非字符串', () => {
    for (const key of ['../settings', 'a/b', '', '   ', '.', '..', '%2e%2e', 'a b', 'a?b', 'a#b', `k${'x'.repeat(200)}`, null, 42, {}]) {
      const v = validateContent({ type: 'terminal', key });
      assert.equal(v.ok, false, `键 ${JSON.stringify(key)} 应被拒绝`);
      assert.equal(v.code, 'invalid_key');
    }
  });

  test('非 ASCII 产物名是合法键（路由经 encodeURIComponent 保安全）', () => {
    const v = validateContent({ type: 'terminal', key: '火山图.png' });
    assert.equal(v.ok, true, '中文产物名应放行');
    assert.equal(buildRouteForId('terminal:火山图.png'), `/window/terminal/${encodeURIComponent('火山图.png')}`);
    assert.ok(!buildRouteForId('terminal:火山图.png').includes('火山'), '路由中不得出现原始非 ASCII 段');
  });

  test('构建出的路由全部落在白名单模式内', () => {
    assert.equal(buildRouteForId('terminal:art_1'), '/window/terminal/art_1');
    assert.equal(buildRouteForId('terminal:default'), '/window/terminal/default');
    assert.equal(buildRouteForId('command-center:'), '/window/command-center');
    // 键经 encodeURIComponent，特殊字符不产生路径段
    assert.equal(buildRouteForId('terminal:a.b-c_d:e'), '/window/terminal/a.b-c_d%3Ae');
    assert.equal(buildRouteForId('rail:'), null, '内部类型不产生路由');
  });
});

// ── 3. geometry 位置记忆 ────────────────────────────────────────

describe('geometry：主进程持有 + 持久化 + 副屏失效回落', () => {
  test('recordGeometry 仅 popped 态可记录且校验形状', () => {
    const core = makeCore();
    assert.equal(core.recordGeometry('terminal:none', { x: 1, y: 1, w: 10, h: 10 }).ok, false);
    core.popOut({ type: 'terminal', key: 'art_1' });
    assert.equal(core.recordGeometry('terminal:art_1', { x: 10, y: 20, w: 800, h: 600, displayId: 1 }).ok, true);
    assert.equal(core.recordGeometry('terminal:art_1', { x: 'a', y: 1, w: 10, h: 10 }).ok, false);
    assert.equal(core.recordGeometry('terminal:art_1', { x: 1, y: 1, w: -5, h: 10 }).ok, false);
    core.minimizeToRail('terminal:art_1');
    assert.equal(core.recordGeometry('terminal:art_1', { x: 1, y: 1, w: 10, h: 10 }).ok, false, 'railed 态不接受 geometry');
  });

  test('弹出新窗回落主屏级联默认位（无记忆时）', () => {
    const core = makeCore();
    // mainBounds 取左上角，避开工作区下缘钳制区（钳制由边界专项用例覆盖）
    const mainBounds = { x: 0, y: 0 };
    core.popOut({ type: 'terminal', key: 'art_1' });
    const r1 = core.resolveLaunchBounds('terminal:art_1', { displays: DISPLAYS, mainBounds });
    assert.equal(r1.reusedMemory, false);
    assert.equal(r1.bounds.w, 880);
    assert.equal(r1.bounds.h, 600);
    assert.equal(r1.displayId, 1, '回落主屏');
    core.popOut({ type: 'terminal', key: 'art_2' });
    const r2 = core.resolveLaunchBounds('terminal:art_2', { displays: DISPLAYS, mainBounds });
    assert.ok(r2.bounds.x > r1.bounds.x && r2.bounds.y > r1.bounds.y, '级联偏移递增');
  });

  test('记忆位置有效且显示器存在 → 复用记忆', () => {
    const core = makeCore();
    core.popOut({ type: 'terminal', key: 'art_1' });
    core.recordGeometry('terminal:art_1', { x: 1500, y: 100, w: 800, h: 600, displayId: 2 });
    const r = core.resolveLaunchBounds('terminal:art_1', { displays: DISPLAYS });
    assert.equal(r.reusedMemory, true);
    assert.equal(r.bounds.x, 1500);
    assert.equal(r.displayId, 2);
  });

  test('副屏失效（displayId 不在当前列表）→ 回落主屏并钳制进工作区', () => {
    const core = makeCore();
    core.popOut({ type: 'terminal', key: 'art_1' });
    core.recordGeometry('terminal:art_1', { x: 5000, y: 100, w: 800, h: 600, displayId: 99 });
    const r = core.resolveLaunchBounds('terminal:art_1', { displays: DISPLAYS, mainBounds: null });
    assert.equal(r.reusedMemory, false);
    assert.equal(r.displayId, 1);
    const wa = DISPLAYS[0].workArea;
    assert.ok(r.bounds.x >= wa.x && r.bounds.x + r.bounds.w <= wa.x + wa.width, 'x 钳制在工作区内');
    assert.ok(r.bounds.y >= wa.y && r.bounds.y + r.bounds.h <= wa.y + wa.height, 'y 钳制在工作区内');
  });

  test('持久化 round-trip：重启后 geometry 记忆恢复', () => {
    let saved = null;
    const coreA = makeCore({
      saveState: (s) => {
        saved = s;
      },
    });
    coreA.popOut({ type: 'terminal', key: 'art_1' });
    coreA.recordGeometry('terminal:art_1', { x: 33, y: 44, w: 700, h: 500, displayId: 1 });
    assert.ok(saved && saved.geometry['terminal:art_1'], 'saveState 被调用且带记忆');

    const coreB = makeCore({ loadState: () => saved });
    coreB.popOut({ type: 'terminal', key: 'art_1' });
    const r = coreB.resolveLaunchBounds('terminal:art_1', { displays: DISPLAYS });
    assert.equal(r.reusedMemory, true);
    assert.deepEqual(
      { x: r.bounds.x, y: r.bounds.y, w: r.bounds.w, h: r.bounds.h },
      { x: 33, y: 44, w: 700, h: 500 },
    );
  });

  test('损坏 / 异形持久化数据被容忍（坏条目跳过，好条目保留）', () => {
    const core = makeCore({
      loadState: () => ({
        version: 1,
        geometry: {
          'terminal:good': { x: 1, y: 2, w: 300, h: 200, displayId: 1 },
          'terminal:bad': { x: 'nope', y: 2, w: 300, h: 200 },
          'garbage-key': { x: 1, y: 2, w: 300, h: 200 },
          'terminal:negative': { x: 1, y: 2, w: -3, h: 200 },
        },
      }),
    });
    core.popOut({ type: 'terminal', key: 'good' });
    assert.equal(core.resolveLaunchBounds('terminal:good', { displays: DISPLAYS }).reusedMemory, true);
    core.popOut({ type: 'terminal', key: 'bad' });
    assert.equal(core.resolveLaunchBounds('terminal:bad', { displays: DISPLAYS }).reusedMemory, false);
  });

  test('isValidGeometry / clampBoundsToWorkArea 纯函数边界', () => {
    assert.equal(isValidGeometry({ x: 0, y: 0, w: 1, h: 1 }), true);
    assert.equal(isValidGeometry({ x: 0, y: 0, w: 1 }), false);
    assert.equal(isValidGeometry(null), false);
    const clamped = clampBoundsToWorkArea({ x: -50, y: -50, w: 2000, h: 2000 }, DISPLAYS[0].workArea);
    assert.deepEqual(clamped, { x: 0, y: 0, w: 1440, h: 860 });
  });
});

// ── 4. 事件多播 / 静态淡出 / 单例 ───────────────────────────────

describe('事件与契约细节', () => {
  test('subscribe 收到 upsert/remove 增量', () => {
    const core = makeCore();
    const events = [];
    core.subscribe((e) => events.push(e));
    core.popOut({ type: 'terminal', key: 'art_1' });
    core.minimizeToRail('terminal:art_1');
    core.remove('terminal:art_1');
    assert.deepEqual(
      events.map((e) => e.kind),
      ['upsert', 'upsert', 'remove'],
      'popOut / minimize 各发一次 upsert；remove 后无 upsert',
    );
    assert.equal(events.at(-1).id, 'terminal:art_1');
  });

  test('persistent 类 railed 条目不淡出（UI-385 后 static 类暂无承载者，机制保留）', () => {
    const core = makeCore();
    core.popOut({ type: 'terminal', key: 'default' });
    core.minimizeToRail('terminal:default');
    const entries = Object.fromEntries(core.getSnapshot().entries.map((e) => [e.id, e]));
    assert.equal(entries['terminal:default'].fadeAfter, null);
  });

  test('command-center 走单例通道，不进状态机注册表', () => {
    const core = makeCore();
    const r = core.popOut({ type: 'command-center' });
    assert.equal(r.ok, true);
    assert.equal(r.action, 'singleton');
    assert.equal(core.getSnapshot().entries.length, 0, '单例不占用状态机条目');
  });

  test('订阅者抛错不影响其他订阅者', () => {
    const core = makeCore();
    const seen = [];
    core.subscribe(() => {
      throw new Error('boom');
    });
    core.subscribe((e) => seen.push(e.kind));
    core.popOut({ type: 'terminal', key: 'art_1' });
    assert.equal(seen.length, 1);
  });
});

// ── 5. 适配器 / 预加载静态契约锁（防 IPC 面漂移）────────────────

describe('适配器与 preload 静态契约', () => {
  const ADAPTER = path.join(__dirname, '..', 'src', 'ipc', 'window-manager.js');
  const PRELOAD = path.join(__dirname, '..', 'src', 'preload.js');

  test('适配器注册 plan §4.3 全部 IPC 通道', () => {
    // BLOCK-92 Wave D2：通道名唯一真源迁 src/ipc/channels.js；锁注册表值 + 适配器引用。
    const registry = fs.readFileSync(path.join(__dirname, '..', 'src', 'ipc', 'channels.js'), 'utf8');
    const src = fs.readFileSync(ADAPTER, 'utf8');
    for (const [channel, key] of [
      ['window:pop-out', 'popOut'],
      ['window:return', 'return'],
      ['window:minimize', 'minimize'],
      ['window:restore', 'restore'],
      ['window:remove', 'remove'],
      ['window:snapshot', 'snapshot'],
      ['window:self', 'self'],
      ['window:state-changed', 'stateChanged'],
    ]) {
      assert.ok(registry.includes(`'${channel}'`), `注册表缺通道 ${channel}`);
      assert.ok(src.includes(`CHANNELS.window.${key}`), `适配器未引用 CHANNELS.window.${key}`);
    }
  });

  test('适配器实现 × 拦截降格契约（close → preventDefault + minimizeToRail）', () => {
    const src = fs.readFileSync(ADAPTER, 'utf8');
    assert.match(src, /win\.on\("close"[\s\S]*?event\.preventDefault\(\)[\s\S]*?core\.minimizeToRail\(id\)/, 'close 事件必须拦截并降格');
  });

  test('适配器只从核心构建路由（不自行拼 URL）', () => {
    const src = fs.readFileSync(ADAPTER, 'utf8');
    assert.match(src, /core\.buildRouteForId\(id\)/, '路由必须经核心白名单构建');
    assert.doesNotMatch(src, /loadURL\(`(?!.*route)/, '不得绕过白名单直接模板拼路由');
  });

  test('P2 契约：terminal.js 向受管窗口转发会话数据（独立终端窗数据面）', () => {
    const termSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'ipc', 'terminal.js'), 'utf8');
    assert.match(termSrc, /forwardToContentWindow\(`terminal:\$\{payload\.sessionId\}`/, 'terminal:data/exit 必须转发到 terminal:<sessionId> 受管窗');
    const adapterSrc = fs.readFileSync(ADAPTER, 'utf8');
    assert.match(adapterSrc, /forwardToContentWindowRef = /, '适配器必须装配转发钩子');
  });

  test('P2 契约：轨道容器窗规格（懒创建/alwaysOnTop/穿透/无 ×）', () => {
    const src = fs.readFileSync(ADAPTER, 'utf8');
    assert.match(src, /setAlwaysOnTop\(true, "floating"\)/, '轨道容器 alwaysOnTop（巡视面）');
    assert.match(src, /setIgnoreMouseEvents\(true, \{ forward: true \}\)/, '条带外点击穿透');
    assert.match(src, /skipTaskbar: true/, '轨道不进任务栏');
    assert.match(src, /focusable: false/, '轨道不抢键盘焦点');
    assert.match(src, /CHANNELS\.window\.railMouse/, '渲染层穿透切换 IPC 存在');
  });

  test('加映二契约：轨道窗加宽容纳 hover 卡 + 降格瞬间快照 + thumbnail IPC', () => {
    const src = fs.readFileSync(ADAPTER, 'utf8');
    assert.match(src, /RAIL_WINDOW_WIDTH = 364/, '轨道窗 364px（预览区 336 + 条带 28），卡片不再被裁剪');
    assert.match(src, /CHANNELS\.window\.thumbnail/, 'thumbnail IPC 存在（轨道卡内容预览）');
    assert.match(src, /capturePage\(\)/, '降格瞬间内容快照（capturePage）');
    assert.match(src, /thumbnails\.delete\(id\)/, '快照随条目终结清理');
    // 快照必须在降格（hide）之前采集——可见态 capturePage 才可靠
    assert.match(src, /await captureThumbnail\(rec\);[\s\S]{0,200}core\.minimizeToRail\(id\)/, '先快照后降格');
    const preloadSrc = fs.readFileSync(PRELOAD, 'utf8');
    assert.match(preloadSrc, /thumbnail:\s*\(id\)/, 'preload 暴露 thumbnail');
  });

  test('加映三契约：轨道滚轮换卡 + 卡片垂直钳位（plan §5 补全）', () => {
    const railSrc = fs.readFileSync(
      path.join(__dirname, '..', 'frontend', 'src', 'components', 'window', 'RailPage.tsx'),
      'utf8',
    );
    assert.match(railSrc, /onWheel=\{handleWheel\}/, '刻度区滚轮换卡 handler 存在');
    assert.match(railSrc, /Math\.min\(Math\.max\(anchorTopRef\.current, CARD_EDGE_GAP\), max\)/, '卡片 top 垂直钳位（复用 UI-255 重钳思路）');
    assert.match(railSrc, /ResizeObserver\(reclamp\)/, '卡片尺寸变化（快照加载）触发重钳');
    assert.match(railSrc, /tickRefs\.current\[entry\.id\] = el/, '刻度锚点 ref 记录');
    const cssSrc = fs.readFileSync(
      path.join(__dirname, '..', 'frontend', 'src', 'components', 'window', 'rail-page.module.css'),
      'utf8',
    );
    assert.match(cssSrc, /max-height: calc\(100vh - 24px\)/, '卡片不超窗口高（钳位兜底）');
  });

  test('P3 契约：指挥中心单例 ×=直接关闭（不进轨道），入口在 TitleBar', () => {
    const shellSrc = fs.readFileSync(
      path.join(__dirname, '..', 'frontend', 'src', 'components', 'window', 'WindowShell.tsx'),
      'utf8',
    );
    assert.match(shellSrc, /closeBehavior = 'rail'/, 'WindowShell 默认 × = 降格（契约）');
    assert.match(shellSrc, /closeBehavior === 'close'[\s\S]*?window\.close\(\)/, 'close 形态走真关闭');
    const ccSrc = fs.readFileSync(
      path.join(__dirname, '..', 'frontend', 'src', 'pages', 'window', 'CommandCenterPage.tsx'),
      'utf8',
    );
    assert.match(ccSrc, /closeBehavior="close"/, '指挥中心 × = 直接关闭（plan §4.1 无状态单例）');
    // UI-362 瓦片墙核心提取至 CommandCenterJobsWall（CommandCenterPage 委托渲染）
    const wallSrc = fs.readFileSync(
      path.join(__dirname, '..', 'frontend', 'src', 'pages', 'window', 'CommandCenterJobsWall.tsx'),
      'utf8',
    );
    assert.match(wallSrc, /listAgentTasks|listAllJobs|tools\/history/, '瓦片只读既有 REST 真相（零第二真相）');
    assert.doesNotMatch(wallSrc, /popOut\('result'/, 'UI-385 — 结果独立窗退役：下钻走主窗右栏 relay');
    // UI-362 — 指挥中心入口迁至右栏 tab + App 全局快捷键（TitleBar 按钮已退役）
    const appSrc = fs.readFileSync(
      path.join(__dirname, '..', 'frontend', 'src', 'App.tsx'),
      'utf8',
    );
    assert.match(appSrc, /popOut\('command-center'\)/, '指挥中心快捷键入口存在（Ctrl/Cmd+Shift+C）');
  });

  test('preload 暴露 windowManager 桥段', () => {
    const src = fs.readFileSync(PRELOAD, 'utf8');
    assert.match(src, /windowManager:\s*\{/, 'petriDesktop.windowManager 缺失');
    for (const method of ['popOut', 'returnToDock', 'minimizeToRail', 'restore', 'remove', 'snapshot', 'self', 'onStateChanged']) {
      assert.match(src, new RegExp(`${method}:\\s*\\(`), `windowManager.${method} 缺失`);
    }
  });

  test('main.js 装配 window-manager IPC（且在 createWindow 之后）', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const setupIdx = src.indexOf('setupWindowManagerIpc(');
    const createIdx = src.indexOf('await createWindow({');
    assert.ok(setupIdx > -1, 'main.js 未装配 setupWindowManagerIpc');
    assert.ok(createIdx > -1 && setupIdx > createIdx, '窗口管理器装配必须晚于 createWindow（SPA base 就绪）');
  });
});
