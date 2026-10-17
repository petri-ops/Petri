/**
 * BLOCK-199 P5 — 配置漂移门（离线·源码扫描，零渲染零网络）。
 *
 * 一条规则：**"注册表说有面，就得真有面；运行时接点加了一个，注册表就得有一个"**。
 * 本包那三个"改了设置不生效/看不见"的缺陷全部属于两侧不同步，而人肉对账靠不住，所以机械钉：
 *  ① 每个注册族必须能在设置侧找到真实承载文件（含对应 API 路径/键名），否则 `ui:'settings'` 是假声明；
 *  ② 每族写路径必须能拒绝（route 源码含 400），否则"写不进"只存在于纯函数里；
 *  ③ `RUNTIME_POINTS` 与注册表的决策接点集合双向相等——report-guard 那种"注册表外隐藏开关"
 *     从此不能悄悄再加（这条就是它留下的教训固化成的门）；
 *  ④ 接点 envKey 两处必须同源。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = require(path.join(ROOT, 'core/packages/shared-config/config-schema.js'));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 族 → 设置侧承载文件与其必须出现的关键字（路径写法照各面板实际 fetch 的端点）。 */
const UI_CARRIERS = {
  'feature-flags': { file: 'frontend/src/components/settings/ExperimentalFeaturesSection.tsx', must: ['/feature-flags'] },
  'decision-points': { file: 'frontend/src/components/desktop/DesktopSettingsPanel/sections/DecisionConfigPanel.tsx', must: ['/ai/decisions/config'] },
  generation: { file: 'frontend/src/components/desktop/DesktopSettingsPanel/sections/GenerationDefaultsPanel.tsx', must: ['/ai/generation-defaults'] },
  'cost-cap': { file: 'frontend/src/components/desktop/DesktopSettingsPanel/sections/UsageCostPanel.tsx', must: ['costCapCny'] },
  // BLOCK-200 两族：键位面真消费注册表 hook（不是自己抄一份显示文本），档位面真打 REST 端点
  keymap: { file: 'frontend/src/components/desktop/DesktopSettingsPanel/sections/KeymapPanel.tsx', must: ['useKeymapSafe'] },
  reasoning: { file: 'frontend/src/components/desktop/DesktopSettingsPanel/sections/ReasoningDefaultsPanel.tsx', must: ['/ai/reasoning-defaults'] },
};

/** 族 → 后端写路由（必须能把拒绝翻译成 4xx，而不是冒 500 或静默）。 */
const WRITE_ROUTES = {
  'feature-flags': 'core/petri-server/routes/feature-flags.js',
  'decision-points': 'core/petri-server/routes/ai-agent/decisions.js',
  generation: 'core/petri-server/routes/ai-settings-api.js',
  'cost-cap': 'core/petri-server/routes/ai-settings-api.js',
  keymap: 'core/petri-server/routes/keymap.js',
  reasoning: 'core/petri-server/routes/ai-settings-api.js',
};

test('注册表自洽：每个键有族、每个族有键（不留空壳族或孤儿键）', () => {
  const families = new Set(Object.keys(schema.CONFIG_FAMILIES));
  for (const entry of schema.CONFIG_KEYS) assert.ok(families.has(entry.family), `孤儿键 ${entry.key}（族 ${entry.family} 未声明）`);
  for (const family of families) {
    assert.ok(schema.CONFIG_KEYS.some((e) => e.family === family), `族 ${family} 声明了却没有任何键（空壳）`);
  }
});

test('声明 ui=settings 的族必须有真实设置面承载（防"注册表说有面，其实没有"）', () => {
  for (const [family, carrier] of Object.entries(UI_CARRIERS)) {
    if (!schema.CONFIG_KEYS.some((e) => e.family === family && e.ui === 'settings')) continue;
    assert.ok(fs.existsSync(path.join(ROOT, carrier.file)), `${family} 的承载文件不存在：${carrier.file}`);
    const src = read(carrier.file);
    for (const needle of carrier.must) assert.ok(src.includes(needle), `${carrier.file} 未引用 ${needle}（${family} 面无数据来源）`);
  }
  const declared = new Set(schema.CONFIG_KEYS.map((e) => e.family));
  assert.deepEqual([...declared].sort(), Object.keys(UI_CARRIERS).sort(), 'UI_CARRIERS 与注册表族集合失配');
});

test('每族写路径都能拒绝非法输入（4xx），而不是静默或冒 500', () => {
  for (const [family, routeFile] of Object.entries(WRITE_ROUTES)) {
    const src = read(routeFile);
    assert.match(src, /status\(400\)/, `${family} 的写路由没有 400 出口 ⇒ 守卫拒绝到不了用户`);
  }
  // generation 的拒绝必须走结构化码，不能把任意异常都当 400 吞掉
  const api = read(WRITE_ROUTES.generation);
  assert.match(api, /config_value_rejected/);
});

test('RUNTIME_POINTS 与注册表接点集合双向相等（report-guard 那类隐藏开关不得复发）', () => {
  const src = read('core/petri-server/helpers/decision-config.js');
  const block = src.slice(src.indexOf('const RUNTIME_POINTS'), src.indexOf('};', src.indexOf('const RUNTIME_POINTS')));
  const runtimePoints = [...block.matchAll(/^\s*'([a-z0-9-]+)':\s*\{/gm)].map((m) => m[1]);
  assert.ok(runtimePoints.length >= 6, `扫到的接点数异常（${runtimePoints.length}）：正则失配还是接点被删？`);
  const registryPoints = schema.CONFIG_KEYS
    .filter((e) => e.family === 'decision-points' && e.path.endsWith('.enabled'))
    .map((e) => e.path.split('.')[0]);
  assert.deepEqual(
    runtimePoints.filter((p) => !registryPoints.includes(p)), [], `注册表外的运行时接点（设置页不可见不可持久化）：${runtimePoints.filter((p) => !registryPoints.includes(p)).join(',')}`,
  );
  assert.deepEqual(
    registryPoints.filter((p) => !runtimePoints.includes(p)), [], `注册表声明了但 RUNTIME_POINTS 没有的接点：${registryPoints.filter((p) => !runtimePoints.includes(p)).join(',')}`,
  );
});

test('接点 envKey 两处同源（注册表别名不能与代码实际读取的变量漂移）', () => {
  const src = read('core/petri-server/helpers/decision-config.js');
  for (const entry of schema.CONFIG_KEYS.filter((e) => e.family === 'decision-points' && e.path.endsWith('.enabled'))) {
    const point = entry.path.split('.')[0];
    const line = src.split('\n').find((l) => l.includes(`'${point}':`));
    assert.ok(line, `RUNTIME_POINTS 里找不到 ${point}`);
    const envKey = (line.match(/envKey:\s*'([A-Z0-9_]+)'/) || [])[1];
    assert.equal(entry.envKeys[0], envKey, `${point} 的 envKey 两处不一致（注册表 ${entry.envKeys[0]} vs 代码 ${envKey}）`);
  }
});

test('BLOCK-201 — 设置全景导出/导入的族集合与注册表逐族相等（漏族/未注册族都红）', () => {
  const transfer = require(path.join(ROOT, 'core/petri-server/helpers/config-transfer.js'));
  assert.deepEqual(
    [...transfer.CONFIG_TRANSFER_FAMILIES].sort(),
    Object.keys(schema.CONFIG_FAMILIES).sort(),
    'TRANSLATE: 导出/导入覆盖面必须等于注册表族集合——新增族忘了接 transfer，用户备份就会静默漏掉它',
  );
  // 每个族都必须能找到写出口名字（WRITERS/RESETTERS 两张表都按族名分派，不得有空壳族）
  const src = read('core/petri-server/helpers/config-transfer.js');
  for (const family of transfer.CONFIG_TRANSFER_FAMILIES) {
    assert.ok(src.includes(`'${family}'`), `config-transfer 里找不到族 ${family} 的分派入口`);
  }
});
