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
  // BLOCK-202 W3 两族
  network: { file: 'frontend/src/components/desktop/DesktopSettingsPanel/sections/NetworkProxyPanel.tsx', must: ['/network'] },
  runtime: { file: 'frontend/src/components/desktop/DesktopSettingsPanel/sections/RuntimePolicyPanel.tsx', must: ['/runtime-policy'] },
  // BLOCK-203 W4a 首族：外观偏好的真值是服务端 user-prefs.json，承载面是 ThemeProvider 的多端同步链
  // （不是设置面板里的某个 fetch）——故 must 钉它实际打的端点，而不是钉一个"看起来像设置页"的文件。
  'user-prefs': { file: 'frontend/src/themes/ThemeProvider.tsx', must: ['/user/prefs'] },
  // BLOCK-203 W4a P3：技能治理面的真承载是 Skills 页的 store hook（走 IPC 桥，不是 REST）
  'skills-prefs': { file: 'frontend/src/hooks/useSkillStore.ts', must: ["getBridge('skills')", 'setDisabled'] },
  // BLOCK-203 W4a P4：用户 Agent 规则的承载面（设置页「常规」→ 规则面板）
  'agent-rules': { file: 'frontend/src/components/desktop/DesktopSettingsPanel/sections/AgentRulesPanel.tsx', must: ['/ai/agent-rules'] },
  // BLOCK-203 W4a P5：MCP 服务货架（扩展中心 → MCP 服务）。数据面在 hook 里（面板只做呈现），
  // 故钉 hook 而不是钉面板——钉面板会变成"文件里出现 mcp 字样"就算过，那种门守不住任何东西。
  'mcp-servers': { file: 'frontend/src/hooks/useMcpServers.ts', must: ['/mcp/servers'] },
  // BLOCK-247（Q2b）联网检索授权面：承载面在「计算与数据」分区（独立路由 /settings?section=compute），
  // 走 REST 端点 /api/web-access（GET 读快照 / PUT 写授权），**不与 network 族混**（生效语义不同）。
  'web-search': { file: 'frontend/src/components/desktop/DesktopSettingsPanel/sections/WebAccessPanel.tsx', must: ['/web-access'] },
  // BLOCK-264（C-37）模型白名单：承载面=模型菜单（选择器逐行禁用与理由展示），读 /ai/model-access
  'model-access': { file: 'frontend/src/components/copilot/SimpleChat/ModelMenu.tsx', must: ['/ai/model-access'] },
};

/**
 * 族 → **有意不提供设置面**的理由（BLOCK-204 起）。
 *
 * 为什么需要这张表：UI 承载断言原本要求"注册表族集合 == UI_CARRIERS 键集合"，于是
 * "没有设置面的族"只能靠**不登记**混过去——那和没有门一样（同样的毛病在 NON_HTTP_WRITE_FAMILIES
 * 上已经修过一次）。登记后改成两条更硬的断言：①该族所有键必须 `ui:'none'`（不许嘴上说没面、
 * 却在注册表里声明有面）；②必须写清理由（表本身是给人看的，理由缺失=没人知道为什么没做）。
 */
const NO_UI_FAMILIES = {
  'mcp-tool-policy': 'W5 v1 只做策略面与执行接线（API 写面 + 投影/超时/合同生效）；逐工具表格 UI 属后续设置面批次',
  'memory-policy': 'W6 v1 只做策略面与生效接线（API 写面 + 压缩/检索/生命周期生效）；设置页属性后续批次',
  'subagent-profile': 'W7a v1 只做声明式派发缺省（API 写面 + spawn 解析）；profile 表格 UI 属后续批次',
  'trust-policy': 'W7b v1 只做信任级与 accessMode 天花板（API 写面 + 审计）；项目信任 UI 属后续批次',
  'data-retention': 'W7e v1 只做留存配置与迁移计划预览（API 写面）；留存 UI 与迁移执行属后续批次/reopen',
};

/** 族 → 后端写路由（必须能把拒绝翻译成 4xx，而不是冒 500 或静默）。 */
const WRITE_ROUTES = {
  'feature-flags': 'core/petri-server/routes/feature-flags.js',
  'decision-points': 'core/petri-server/routes/ai-agent/decisions.js',
  generation: 'core/petri-server/routes/ai-settings-api.js',
  'cost-cap': 'core/petri-server/routes/ai-settings-api.js',
  keymap: 'core/petri-server/routes/keymap.js',
  reasoning: 'core/petri-server/routes/ai-settings-api.js',
  network: 'core/petri-server/routes/runtime-config.js',
  runtime: 'core/petri-server/routes/runtime-config.js',
  'user-prefs': 'core/petri-server/routes/user-prefs.js',
  'agent-rules': 'core/petri-server/routes/ai-settings-api.js',
  'mcp-servers': 'core/petri-server/routes/mcp-client.js',
  'mcp-tool-policy': 'core/petri-server/routes/mcp-client.js',
  'memory-policy': 'core/petri-server/routes/ai-memory.js',
  'subagent-profile': 'core/petri-server/routes/subagent-profiles.js',
  'trust-policy': 'core/petri-server/routes/trust-policy.js',
  'data-retention': 'core/petri-server/routes/data-retention.js',
  // BLOCK-264（C-37）— PUT /api/ai/model-access（元素级字符串校验 400）
  'model-access': 'core/petri-server/routes/ai-settings-api.js',
  // BLOCK-247（Q2b）：联网授权写面与 runtime-policy 同文件（同一路由装配单元），拒绝码同构（400 + diagnostics）。
  'web-search': 'core/petri-server/routes/runtime-config.js',
};

/**
 * 族 → **没有 HTTP 写面**时的写表面（IPC / SDK）。
 *
 * 为什么需要这张表：② 那条规则（"每族写路径必须能拒绝 400"）对 Electron IPC 族是**测不到的**，
 * 而"不登记就跳过"等于让门对该族空转——比没有门更糟（BLOCK-195 的"幽灵锚点"就是这个形状）。
 * 登记后改成三条更硬的断言：①它**确实没有** HTTP 写入口；②它的写表面有明确拒绝码；
 * ③IPC 通道在 main 进程真的接上了。
 */
const NON_HTTP_WRITE_FAMILIES = {
  'skills-prefs': {
    surface: 'core/shared-backend/skill-prefs.js',
    must: ['invalid_skill_id', 'skill_id_required'],
    // 通道字面量的唯一注册表是 src/ipc/channels.js，main.js 通过常量接线（不重复字面量）
    channelFile: 'src/ipc/channels.js',
    channel: "'skills:set-disabled'",
    handlerFile: 'src/main.js',
    handler: 'CHANNELS.skills.setDisabled',
  },
};

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('注册表自洽：每个键有族、每个族有键（不留空壳族或孤儿键）', () => {
  const families = new Set(Object.keys(schema.CONFIG_FAMILIES));
  for (const entry of schema.CONFIG_KEYS) assert.ok(families.has(entry.family), `孤儿键 ${entry.key}（族 ${entry.family} 未声明）`);
  for (const family of families) {
    assert.ok(schema.CONFIG_KEYS.some((e) => e.family === family), `族 ${family} 声明了却没有任何键（空壳）`);
  }
});

test('声明 ui=settings 的族必须有真实设置面承载（防"注册表说有面，其实没有"）', () => {
  // 有意无设置面的族：必须 ui:'none' 且写了理由
  for (const [family, reason] of Object.entries(NO_UI_FAMILIES)) {
    assert.ok(reason && reason.length > 10, `${family} 进 NO_UI_FAMILIES 必须写清理由`);
    const keys = schema.CONFIG_KEYS.filter((e) => e.family === family);
    assert.ok(keys.length > 0, `${family} 在注册表里不存在`);
    for (const entry of keys) assert.equal(entry.ui, 'none', `${family} 声明无设置面，键 ${entry.key} 却标了 ui:'settings'`);
  }
  for (const [family, carrier] of Object.entries(UI_CARRIERS)) {
    if (!schema.CONFIG_KEYS.some((e) => e.family === family && e.ui === 'settings')) continue;
    assert.ok(fs.existsSync(path.join(ROOT, carrier.file)), `${family} 的承载文件不存在：${carrier.file}`);
    const src = read(carrier.file);
    for (const needle of carrier.must) assert.ok(src.includes(needle), `${carrier.file} 未引用 ${needle}（${family} 面无数据来源）`);
  }
  const declared = new Set(schema.CONFIG_KEYS.map((e) => e.family));
  assert.deepEqual(
    [...declared].sort(),
    [...Object.keys(UI_CARRIERS), ...Object.keys(NO_UI_FAMILIES)].sort(),
    'UI_CARRIERS ∪ NO_UI_FAMILIES 必须覆盖注册表族集合（既不能漏登记，也不能两边都登记）',
  );
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

test('每族都有一条"会拒绝"的写路径：HTTP 或显式登记的非 HTTP 写面（不许空转）', () => {
  const declared = [...new Set(schema.CONFIG_KEYS.map((e) => e.family))].sort();
  for (const family of declared) {
    const viaHttp = Object.prototype.hasOwnProperty.call(WRITE_ROUTES, family);
    const viaOther = Object.prototype.hasOwnProperty.call(NON_HTTP_WRITE_FAMILIES, family);
    assert.ok(!(viaHttp && viaOther), `${family} 同时登记了 HTTP 与非 HTTP 写面（分不清真相在哪）`);
    assert.ok(viaHttp || viaOther, `${family} 既没有 HTTP 写路由也没进 NON_HTTP_WRITE_FAMILIES——"写路径能拒绝"这条门对它是空转`);
  }
});

test('非 HTTP 写面的族：确实没有 HTTP 入口 + 写面有拒绝码 + IPC 通道已接线', () => {
  const routeFiles = walk(path.join(ROOT, 'core/petri-server/routes'));
  for (const [family, spec] of Object.entries(NON_HTTP_WRITE_FAMILIES)) {
    const surface = read(spec.surface);
    for (const needle of spec.must) assert.ok(surface.includes(needle), `${spec.surface} 缺拒绝码 ${needle}（该族写面无法说"不"）`);
    assert.ok(read(spec.channelFile).includes(spec.channel), `${spec.channelFile} 未登记通道字面量 ${spec.channel}`);
    assert.ok(read(spec.handlerFile).includes(spec.handler), `${spec.handlerFile} 未接线处理器 ${spec.handler}（通道登记了但没人接=死通道）`);
    // 反向：routes/ 下不许出现该族的写入口（否则这张表就是骗人的，真相变成两份）
    for (const needle of ['skill-prefs', 'setSkillDisabled']) {
      const offenders = routeFiles.filter((file) => fs.readFileSync(file, 'utf8').includes(needle));
      assert.deepEqual(
        offenders.map((file) => path.relative(ROOT, file)),
        [],
        `${family} 声称"无 HTTP 写面"，但 routes/ 里出现了 ${needle}`,
      );
    }
  }
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
