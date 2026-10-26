/**
 * BLOCK-203 W4b P0 — 配置落点总账（14 处）机械对账。
 *
 * 为什么需要它：BLOCK-199 测绘出「14 处持久化落点」，但**只有 4 处能被注册表族解释**；
 * 其余长期以"B1b 未做"悬着，于是"覆盖率 4/14、10/14、8/14"三个数在文档里并存过
 * （11 vs 10 的口径错误就是这么来的）。本测把 14 处逐条钉成一张表：每处必须有
 * **归属**（注册表族 / 运行时态 / 授权数据 / 待收编）与**理由**，且：
 *  ① 注册表里每个族都必须能映射回某处落点（防"注册了一个不存在的落点"）；
 *  ② 标 `runtime-state` / `authz` 的落点**不得**出现在注册表族里（防把 UI 状态或权限
 *     数据顺手做成"可导出配置"——那是安全边界越界，不是收编）；
 *  ③ 落点清单本身冻结：增删必须显式改本表（跟 BLOCK-201 的设置分区冻结同一个道理）。
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = require(path.join(ROOT, 'core/packages/shared-config/config-schema.js'));

/**
 * 落点总账（当前全集）。`core14: true` = BLOCK-199 测绘的那 14 处；其余是 W1–W3 新增的
 * 文件族（keymap/network/runtime-policy），**不抵 14 的账**（口径更正时已写死）。
 * `families` 为空 = 该落点不是配置（必须写 disposition + 理由）。
 */
const LANDING_POINTS = Object.freeze([
  // —— BLOCK-199 的 14 处 ——
  { id: 'feature-flags', core14: true, kind: 'file', families: ['feature-flags'], note: '功能开关' },
  { id: 'decision-config', core14: true, kind: 'file', families: ['decision-points'], note: '决策接点启用档/阈值' },
  { id: 'ai-settings', core14: true, kind: 'file', families: ['generation', 'cost-cap', 'reasoning'], note: '生成参数/成本上限/推理档位（一处文件承载三族）；顶层白名单见 P6' },
  { id: 'user-prefs', core14: true, kind: 'file', families: ['user-prefs'], note: '外观偏好真值（localStorage 只是缓存）' },
  { id: 'skills-prefs', core14: true, kind: 'file', families: ['skills-prefs'], note: '技能治理账本（用户态根）' },
  { id: 'agent-rules', core14: true, kind: 'file', families: ['agent-rules'], note: '用户 Agent 规则（集合型）' },
  { id: 'mcp-servers', core14: true, kind: 'file', families: ['mcp-servers'], note: '第三方 MCP server 清单（env 密文、导出剥离）' },
  { id: 'site-settings', core14: true, kind: 'sqlite', families: [], disposition: 'runtime-state', note: '站级 KV（如 guest_permissions）：与授权/站点运行态绑定，不进配置导出' },
  { id: 'execution-targets.runtime_json', core14: true, kind: 'sqlite', families: [], disposition: 'runtime-state', note: '每个执行目标的运行时覆盖：行绑定数据，不是全局配置' },
  { id: 'gen-ui-widget-state.state_json', core14: true, kind: 'sqlite', families: [], disposition: 'runtime-state', note: 'Gen UI 组件留存状态：UI 运行时数据，不是配置' },
  { id: 'users.permissions', core14: true, kind: 'sqlite', families: [], disposition: 'authz', note: '每用户权限：授权数据；做成可导出配置=越安全边界' },
  { id: 'window-manager-state', core14: true, kind: 'file', families: [], disposition: 'runtime-state', note: '主进程窗口位置/尺寸记忆：不可迁移的机器态' },
  { id: 'main-process-route-state', core14: true, kind: 'electron-store', families: [], disposition: 'runtime-state', note: '主进程路由态（last-url 记忆，BLOCK-185）：窗口要恢复哪个页面，不是用户配置' },
  { id: 'renderer-localstorage', core14: true, kind: 'webstorage', families: [], disposition: 'cache', note: '外观启动缓存：真值在 user-prefs.json；键名由 prefCache.drift 测钉住' },
  // —— W1–W3 新增文件族（不计入 14 处）——
  { id: 'keymap', core14: false, kind: 'file', families: ['keymap'], note: '应用级键位（BLOCK-200 新增）' },
  { id: 'network', core14: false, kind: 'file', families: ['network'], note: '代理与自签 CA（BLOCK-202 新增）' },
  { id: 'runtime-policy', core14: false, kind: 'file', families: ['runtime'], note: '审批默认档位/并发深度/工具曝光（BLOCK-202 新增）' },
  { id: 'mcp-tool-policy', core14: false, kind: 'file', families: ['mcp-tool-policy'], note: 'MCP 逐工具策略（BLOCK-204 / W5 新增，无设置面）' },
  // BLOCK-221（Q8）刻意**不**把 MCP 服务级治理策略做成注册表族：信任位与允许/阻断属于
  // 安全决策，跟着「设置全景导出」走会在别的机器上还原出别人的信任判断（导出即越权）。
  { id: 'mcp-server-policy', core14: false, kind: 'file', families: [], disposition: 'runtime-state', note: 'MCP 服务级治理策略（trust/allow/block）：安全决策，读侧 fail-closed，刻意不进配置导出' },
  // —— W6/W7 后续新增族（此前只进注册表、漏登记本总账；2026-10-20 随 BLOCK-221 补齐）——
  { id: 'data-retention', core14: false, kind: 'file', families: ['data-retention'], note: '数据保留策略（BLOCK-205 邻域新增，无设置面）' },
  { id: 'memory-policy', core14: false, kind: 'file', families: ['memory-policy'], note: '记忆与压缩策略（BLOCK-205 / W6 新增，无设置面）' },
  { id: 'subagent-profile', core14: false, kind: 'file', families: ['subagent-profile'], note: '子智能体 profile 声明（BLOCK-206 / W7a 新增，只收紧不放松）' },
  { id: 'trust-policy', core14: false, kind: 'file', families: ['trust-policy'], note: '项目级信任策略（BLOCK-207 邻域新增，无设置面）' },
  // BLOCK-247（Q2b）联网检索授权与预算：有真实设置面（计算与数据分区 → /api/web-access）
  { id: 'web-search', core14: false, kind: 'file', families: ['web-search'], note: '联网检索授权/后端/预算/域名黑白名单（BLOCK-247 新增，有设置面）' },
  // BLOCK-264（C-37）模型选择器权限来源：file:model-access.json（GET/PUT /api/ai/model-access）
  { id: 'model-access', core14: false, kind: 'file', families: ['model-access'], note: '模型白名单 + 逐模型理由账本（BLOCK-264 新增，有 REST 写面）' },
]);

test('BLOCK-203 W4b P0 — 落点总账：BLOCK-199 的 14 处 + 后续新增 4 族，每处有归属与理由', () => {
  const core14 = LANDING_POINTS.filter((point) => point.core14);
  assert.equal(core14.length, 14, `BLOCK-199 的落点必须是 14 处（实得 ${core14.length}）——新增族不得拿来抵数`);
  assert.equal(LANDING_POINTS.length, 25, `当前全集应为 14 + 11（W1–W3 三族 + W5 一族 + Q8 一族 + W6/W7 四族 + Q2b 一族 + C-37 model-access；实得 ${LANDING_POINTS.length}）`);
  const ids = LANDING_POINTS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, `落点 id 重复：${ids.join(',')}`);
  for (const point of LANDING_POINTS) {
    if (point.families.length > 0) continue;
    assert.ok(point.disposition, `${point.id} 没有归属（families 为空时必须声明 disposition）`);
    assert.ok(point.note && point.note.length > 8, `${point.id} 缺理由（非配置落点必须写清为什么不进注册表）`);
  }
});

test('BLOCK-203 W4b P0 — 每个注册表族都能映射回一处落点（防"注册了不存在的落点"）', () => {
  const declared = [...new Set(schema.CONFIG_KEYS.map((e) => e.family))].sort();
  const mapped = [...new Set(LANDING_POINTS.flatMap((p) => p.families))].sort();
  assert.deepEqual(declared, mapped, '注册表族集合与落点总账的 families 必须逐族相等');
});

test('BLOCK-203 W4b P0 — 运行时态/授权落点不得被做成注册表族', () => {
  for (const point of LANDING_POINTS) {
    if (point.families.length > 0) continue;
    assert.ok(
      !Object.prototype.hasOwnProperty.call(schema.CONFIG_FAMILIES, point.id),
      `${point.id} 标为 ${point.disposition || '非配置'}（families 为空）却出现在注册表里——那不是收编，是越界`,
    );
    for (const family of point.families) {
      assert.ok(schema.CONFIG_FAMILIES[family], `${point.id} 声明的族 ${family} 在注册表里不存在`);
    }
  }
});
