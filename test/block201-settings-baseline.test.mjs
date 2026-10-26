/**
 * BLOCK-201 W2 — 拆前基线（设置搜索/分区过滤/按区重置/全景导出导入）。
 *
 * 本文件在实现前写下并跑红（`config-transfer` 尚不存在），实现后转绿；此后**冻结**：
 * 它钉住的是「设置分区清单」与「注册表族/键集合」这两份事实，任何一边悄悄增删都必须
 * 显式改本文件——这正是本包要防的「搜索索引漏分区 / 导出漏族」。
 *
 * 三条事实：
 *  ① 设置面板分区清单 = 10 项（BLOCK-200 加了 keymap/reasoning 后从 8 变 10；
 *     `docs/stage-3-4-execution-runlist.md` 的「8 分区」口径已过时，本包按实况登记）；
 *  ② 配置注册表 = 15 族 / 81 键（+ BLOCK-205 / BLOCK-206 各一族）；
 *  ③ 导出/导入的族集合必须与注册表**逐族相等**（不得偷偷漏族或加未注册族）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const schema = require(path.join(ROOT, 'core/packages/shared-config/config-schema.js'));

const SETTINGS_TYPES = 'frontend/src/components/desktop/DesktopSettingsPanel/types.ts';

test('设置分区清单冻结：10 个分区 id（搜索索引必须逐项覆盖）', () => {
  const src = read(SETTINGS_TYPES);
  const ids = [...src.matchAll(/\{ id: '([a-z-]+)', label:/g)].map((m) => m[1]);
  assert.deepEqual(ids, [
    'general', 'models', 'compute', 'usage', 'decisions',
    'keymap', 'reasoning', 'diagnostics', 'experimental', 'maintenance',
  ]);
  assert.equal(ids.length, 10, `分区数应为 10（实得 ${ids.length}）：${ids.join(', ')}`);
});

test('配置注册表冻结：19 族 / 108 键（BLOCK-210 data-retention；BLOCK-223 user-prefs 2 键；BLOCK-225 autoModel；BLOCK-226 quietHours；BLOCK-227 roleRevealSeen；BLOCK-228 crashNotice；BLOCK-247 web-search 8 键；BLOCK-249 subagent-profile tools 2 键；BLOCK-258 mcp-servers headers；BLOCK-264 C-37 model-access 2 键）', () => {
  // 2026-10-17 两次显式上调（BLOCK-203 W4a）：
  //  P1+P2：8 族/35 键 → 9 族/38 键（user-prefs：theme/fontScale/accent）；
  //  P3   ：9 族/38 键 → 10 族/43 键（skills-prefs：version + disabled.<id>.{at,reason}
  //         + uninstalledSources.<id>.{sourceDir,at}）。
  // 上调理由写在这里而不是只改数字；数字变化必须伴随 config-transfer 族集合与漂移门登记
  // （下一条断言 + drift 测守着）。skills-prefs 的写面是 IPC，故 drift 门按
  // NON_HTTP_WRITE_FAMILIES 登记而不是硬塞一个假的 400 路由。
  //   P4   ：10 族/43 键 → 11 族/51 键（agent-rules：version + 7 个条目字段）。
  //   P5   ：11 族/51 键 → 12 族/60 键（mcp-servers：version/savedAt + 7 个条目字段；
  //          条目数上限走族级 maxItems，args 条数上限走字段 domain.maxItems）。
  //   BLOCK-204（W5）：12 族/60 键 → 13 族/65 键（mcp-tool-policy：projectionLimit
  //   + 逐工具 tool/enabled/timeoutMs/contractMode）。
  //   BLOCK-205（W6）：13 族/65 键 → 14 族/75 键（memory-policy：9 可写标量 + 嵌入模型只读）。
  //   BLOCK-206（W7a）：14 族/75 键 → 15 族/81 键（subagent-profile：default + 5 条目字段）。
  //   BLOCK-207（W7b）：15 族/81 键 → 16 族/84 键（trust-policy：defaultLevel + project/level）。
  assert.equal(Object.keys(schema.CONFIG_FAMILIES).length, 19);
  //   BLOCK-264（C-37）：18 族/106 键 → 19 族/108 键（model-access：allowedModels 白名单 +
  //     reasonNotes 理由账本；模型选择器权限来源，GET/PUT /api/ai/model-access）。
  //   BLOCK-208（W7c）：84 → 86 键（user-prefs + motion 接线 / density 仅登记）。
  //   BLOCK-210（W7e）：86 → 89 键（data-retention：historyDays/archiveDir/maxBytesPerDir）。
  //   BLOCK-223（Q9 续项）：89 → 91 键（user-prefs + notifyOnTurnEnd / closeToTray，
  //     默认值语义=通知开、关窗即退出，主进程只持渲染进程推送的镜像）。
  //   BLOCK-225（Q9 D4）：91 → 92 键（user-prefs + autoModel，默认关；只在发送时解析，不改 active 绑定）。
  //   BLOCK-226（Q9 通知中心）：92 → 93 键（user-prefs + quietHours，空=关；只抑制系统 toast）。
  //   BLOCK-227（Q9 首启揭示）：93 → 94 键（user-prefs + roleRevealSeen，默认 false）。
  //   BLOCK-228（Q9 崩溃提示）：94 → 95 键（user-prefs + crashNotice，默认 true）。
  //   BLOCK-247（Q2b）：17 族/95 键 → 18 族/103 键（web-search：enabled/provider/searxngBaseUrl/
  //     maxResults/timeoutMs/fetchMaxBytes/allowedHosts/blockedHosts；默认关 + 即时生效，
  //     独立成族不塞 network——network 是"往 env 写代理"的源头（有"需重启"语义），两者混族会造出第二套真相）。
  //   BLOCK-249（Q4a）：103 → 105 键（subagent-profile + tools.allow/tools.deny：子代理工具约束只收紧）。
  //   BLOCK-258（Q8-REM）：105 → 106 键（mcp-servers + headers：远程传输自定义凭据头，落盘密文/导出剥离）。
  assert.equal(schema.CONFIG_KEYS.length, 108);
});

test('导出/导入的族集合 == 注册表族集合（漏族/未注册族都算红）', () => {
  const { CONFIG_TRANSFER_FAMILIES } = require(path.join(ROOT, 'core/petri-server/helpers/config-transfer.js'));
  assert.deepEqual(
    [...CONFIG_TRANSFER_FAMILIES].sort(),
    Object.keys(schema.CONFIG_FAMILIES).sort(),
  );
});

test('导出永不包含凭据字段（D-2 静态面：schema 与 transfer 源码都不出现 key 明文出口）', () => {
  const src = read('core/petri-server/helpers/config-transfer.js');
  for (const forbidden of ['apiKey', 'credential', 'secret']) {
    assert.ok(!new RegExp(`${forbidden}\\s*:`).test(src), `config-transfer 不得构造 ${forbidden} 字段`);
  }
  assert.match(src, /EXCLUDES|excludes/, '导出必须显式声明排除清单（凭据/未注册落点）');
});
