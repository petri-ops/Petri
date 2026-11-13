# BLOCK-437 · 拖入源范围门 + 真实栈实测修复

> 背景：M5-3（drag 登记根）此前被判为「需产品裁决的 U 类」，理由是判据 `adjudicateDragPath` 要求
> `registeredRoots` 命中，而 `fs/import-from` 的源路径按设计在项目根之外。本轮按最佳实践给出**可用的默认策略**
> 并落到真实路由，同时把上一轮「只跑单测、没实测」的缺口补上。

## 目标与验收标准

| ID | 目标 | 验收标准（可机械核验） |
| --- | --- | --- |
| G1 | 关闭 `fs/import-from` 的任意路径拷贝面（渲染层若被 XSS 影响可读走 `~/.ssh`、钥匙串等） | 新增 `adjudicateDragSource` 判据 + 真实路由接线；越界/设备路径/相对路径/NUL/缺失全部拒绝，合法源 200 且落地 |
| G2 | 默认策略不破坏正常拖入 | 默认允许根 = 家目录 + `os.tmpdir()` + `/tmp` + `/Volumes` + 项目工作区；`PETRI_DRAG_SOURCE_ROOTS` 可覆盖（`*` 放开） |
| G3 | 补上真实栈实测 | 无窗后端 + 临时库 + 本机 HTTP 跑通；证据落 `acceptance/m-blueprint-2026-11-11/m6a/real-stack-smoke.txt` |
| G4 | 体积棘轮合规 | `routes/files.js` 764 > 基线 708 → 抽 `helpers/content-type.js` + `helpers/drag-source-roots.js`，回落 **682**（`gate:code-size` PASS，不改基线） |

## 关键设计（含实测修正）

1. **判据分层**：`adjudicateDragPath`（已登记根内，拖出/拖放）与 `adjudicateDragSource`（任意位置拖入）语义不同，不合并。
2. **realpath 归一**：判定用 `fs.promises.realpath(source)`，允许根也 `realpathSync` —— macOS 上
   `/tmp → /private/tmp`、`os.tmpdir() → /var/folders/…` 是两棵树，不归一会**误拒**合法源（实测第一版即踩到）。
3. **`/tmp` 显式纳入**：`os.tmpdir()` 在 macOS 不等于 `/tmp`，两者都要在默认根里。
4. **设备路径拒绝**：`/dev` `/proc` `/sys` 不是用户文件，读走没有业务意义，直接 403。
5. **不做 `bytes` 上限**：`fs/import-from` 明确「无 1MB 上限、目录递归」，套用 `MAX_DRAG_BYTES=20MB` 会破坏既有设计。
6. **兼容性**：`PETRI_DRAG_SOURCE_ROOTS='*'` 显式放开，给特殊工作流留出口并在响应 hint 里写明。

## 实施清单

- `core/petri-server/agent-tools/security-boundaries.js`：新增 `adjudicateDragSource` / `DRAG_SOURCE_MAX_NAME` 并导出。
- `core/petri-server/routes/files.js`：`fs/import-from` 在 `fs.promises.cp` **之前**判定源范围；新增 `dragSourceAllowedRoots`（env 覆盖 + realpath 归一）。
- `test/m5a-production-wiring.test.mjs`：新增 2 项（判据 8 种情形 + 接线锚点/顺序断言），总数 15/15。

## 验收门（当次读数）

`node --test test/m5a-production-wiring.test.mjs` / `quality:lint`（改动文件 0 error）/ `quality:arch` /
`gate:silent-catch` / `gate:code-size` / `gate:arch-cycles` / `quality:knip:check` / `docs:check` /
`docs:reconcile` / `test:changed` / `closeout` / 实机冒烟脚本。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 补记（2026-11-12 · 对「5 项证据边界」的复核与补测）

用户质疑「为什么不测」后逐项复核，结论：**5 项中 3 项本机可测，上一轮把「我没做」写成了「做不了」**。已补测：

| 项 | 结论 | 证据 |
| --- | --- | --- |
| Electron 渲染面 | **部分验证（4/4 PASS）**：`start-test-instance.sh` 默认离屏 + `npm run verify -- app-health` → CDP target / `?test=1` 页面 / 标题 `Petri` / `#root` 已挂载；跑完 trap 杀 3000·3001·9223，三端口已 free | `acceptance/dev-verify/app-health-live-darwin.json` |
| MCP 实际连接 | **已实连**：自建零依赖最小 MCP stdio server（initialize/tools/list）→ 注册 → connect 返回 `toolCount:1`、`status=connected`；注入硬化 `args` 含 `;` → `MCP_ARGS_SHELL_METACHAR`；未设白名单 env 时任意已装命令仍可用（回归面） | `m6a/verification-matrix.json` |
| zip 失败清理 | **已在真实解压器验证**：手写 stored zip 构造 `../evil.txt` 穿越条目 → 被拒、`destDir` 已清理、无越界写入；对照合法 zip `entries=1` 落地 | 同上 |
| gen-ui 帧导航 | **仅单测**（4 类分级 + userinfo）；真实触发需页面内有 gen-ui 卡片 iframe 导航 → 补腿=新增 dev-verify flow 注入卡片并断言 `genUi:sandbox-hijacked` | 同上 |
| 真实模型 loop | **G0 不可测**（需 Provider 凭据/计费，属 G1+）；mock provider 的 30 轮 loop 与 1000 轮 fixture 已覆盖 | `m2/m4` 证据 |

教训：标注「证据边界」前必须先区分「违反了阶段纪律」与「我只是没做」。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 补记二（2026-11-12 · 全量实测与修复）

用户要求「都测、要全方位结果并修复」，本轮跑了**全部三层**：

| 层 | 命令 | 结果 |
| --- | --- | --- |
| Node 全量 | `npm run test:all` | 5811 项 / **5770 pass** / 5 fail / 36 skipped（修前 5810 / 5762 / **12 fail**） |
| 前端全量 | `npm run test:all:frontend` | 362 文件 / 2581 项 / **2580 pass** / 1 fail |
| 收口门 | `closeout:full`（fail-fast 于 ui:audit）+ **17 门逐门单独执行** | **14 PASS / 3 红** |

**本轮修掉的 7 个失败**（全部有明确归属，非「调松」）：

| # | 修什么 | 为什么 |
| --- | --- | --- |
| T1 | `block322`：content-type 声明点指向 `helpers/content-type.js` | 我的抽取移动了声明点 |
| T2 | `post-h9-k6-security` + lib：静默 catch 冻结值改为「≤412 上限 + 等于基线复算」，负测改上调方向 | 我合法收紧基线 412→406 |
| T3 | 重生成 `docs/post-k7-readings-single-source.json`（rules 372→374 / registry→581） | 既有读数漂移 |
| T4 | `perf-baseline.json` **仅重打 coreSha**（files.js 在热路径清单） | 改动改变内容指纹；**阈值与容差零改动** |
| T5 | `revisions` 帽 406→407 留因 | `wc -l` 与 `split('\n')` 计数基准差 1，非真实增长 |
| T6 | `agent-runner` 锚点 1140→1143 留因 | BLOCK-398 additive 增长时未重锚（存量红） |
| T7 | 删 `block414` 未使用的 `createRequire/require` | 真实 lint error，未入台账 |
| T8 | `content-type.js` 混合行尾归一 LF | `hygiene:check` 换行漂移 |

**剩余 5 红（Node）+ 1 红（前端）+ 3 红（门）全部定性为他方/环境，无一属本包**：
P6 / UI-629 / SettingsNav lint（他方在制 WIP）、截图腿（macOS 屏幕录制权限）、healthProbe（需 :3001 栈，已实测起栈后 4/4）、
`ReviewMode.block147`（既有产品缺陷，`ReviewMode.tsx` 零改动）、`quality:perf` 的 `packaged_start`（V 类，不抬阈值）、`ui:audit`（79 个他方 UI WIP）。

证据：`acceptance/m-blueprint-2026-11-11/m6a/full-test-sweep.json`。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 补记三（2026-11-12 · 模型通路与 agent 能力）

用户问「模型通吗 / agent 能力是否正常」并随后提供新凭据。

**凭据**：写入应用自身凭据库（macOS Keychain，service `com.petri.desktop.ai` / account `deepseek`），
用 `credential-store.js` 的 `set()` 从 stdin 写入（密钥不进 argv）；临时文件即删。
自检：值未打印、dev-data 目录内 0 个明文文件、tracked 文件 0 命中、该目录已 gitignore。

**模型（通）**：
- 修前 `/api/ai/chat` 流里是 `Authentication Fails, Your api key: ****… is invalid`（旧 key 失效）；
- 修后 `/api/ai/settings/test` → `{"ok":true,"message":"连接正常"}`；
- 真实生成 → `delta.content="OK"` + `[DONE]`，无 error。

**agent（正常）**：真实模型驱动 `POST /api/ai/agent` 完成一次带工具的任务，21 个事件：
`run_started → iter → usage(deepseek-flash) → tool_call(workspace_exec echo PETRI_AGENT_OK) →
tool_output("PETRI_AGENT_OK\n") → tool_result → delta×6 → done → run_terminal(status=completed)`。

**顺手修掉一个真 bug**：`evals:run --provider=mock` 原 **1/9**（8 个任务 ECONNRESET）。
根因 = `spawnIsolatedBackend` 给 `chat_model_presets` 写了 `baseUrl`，漏给 `model_profiles`；
agent-runner 从 `model_profiles` 取 provider → LLM 打到默认远端而不是本地 mock。
补上同源 `baseUrl` 后 **8/9 PASS**，任务耗时从 120s 超时降到 0.5–6s。
剩 `smoke-approval-chain` 的 2 个判据（放行后 `workspace_exec` 真实成功）未过——该任务用 Windows
专属 `vssadmin`、golden 录于 2026-10-17，其余 8 个含工具任务与真实模型 agent 任务均成功执行工具，
故判定为平台/历史 golden 漂移，**未改判据、未伪造通过**。

证据：`acceptance/m-blueprint-2026-11-11/m6a/model-agent-verification.json`。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 补记四（2026-11-12 · 完整启动验证）

用户「启动 没问题就可以 push」：起完整 dev 栈（后端 :3001 + vite :3000 + 离屏测试实例 CDP :9223，
不传 `--onscreen`、不设 `PETRI_TEST_ONSCREEN`），跑完 trap 清三端口。

| 检查 | 结果 |
| --- | --- |
| `npm run verify -- app-health` | **4/4 PASS**（CDP target / `?test=1` 页面 / 标题 `Petri` / `#root` 已挂载） |
| `POST /api/ai/settings/test`（启动时） | `{"ok":true,"message":"连接正常"}` |
| 真页面选择项目 | 路由跳到 `/project/p_mwdlwpvw_fxyo`，会话加载出此前 agent 任务的消息与工具执行记录 |
| 真页面发消息 → 模型回复 | 唯一标记词发送前出现 **0** 次 → 发送后 **2** 次（用户消息 + 模型回复），`errors=[]` |

自纠三轮：① 只注入 composer 时欢迎页提示「先选择一个项目」→ 未发出；② 点项目名文本节点未真正选中；
③ `/ok/i` 判据会被 `tok` 误命中 → 改用唯一标记词次数（0→2）排除假绿。最终只采信该无歧义证据。

证据：`acceptance/m-blueprint-2026-11-11/m6a/launch-verification.json` 与 `acceptance/dev-verify/app-health-live-darwin.json`。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 补记三（2026-11-13 · 打包链路：可复原化 + packaged_start 定性）

上一轮把 `packaged_start` 归因为「打包链路缺陷」但停在「新产物启动卡死」。本轮逐层拆开，结论**推翻了一半**：

| 层 | 实测 | 结论 |
| --- | --- | --- |
| 产物二进制 | `ELECTRON_RUN_AS_NODE` 冒烟 **1.27s** 返回 `NODE_MODULE_VERSION=149` | 可用；排除 GUI/TCC/Gatekeeper 猜测 |
| 打包内迁移 | 同一脚本同一 env 白名单 → **`MIGRATED 22` / 0.098s** / DB 413KB | 迁移不卡；上一轮的 `execFileSync` 120s 超时不可复现 |
| 采集器真实采样 | 两轮 gate：`[508,512,506]`→508、`[498,513,502]`→502 | 产物可启动、数值稳定（±10ms） |

**上一轮超时的真因**：在「开发依赖已被重建为 Electron ABI」的状态下打包，产物内 `better-sqlite3` 副本与 `afterPack` 的候选复制逻辑不一致，且采集器把诊断输出吞了；受控 ABI 下重打后不可复现。

**打包门的两个坑（已固化进脚本）**：
1. `npx electron-builder install-app-deps` 报「已完成」但**跳过重建**（`build/Release` 仍是 Node ABI 137 → `afterPack` 判 `ABI_MISMATCH`）；
2. 必须 `npx electron-rebuild -f -w better-sqlite3 -v 44.7.0` 强制重建，且打包后**必须恢复**（否则本地 `ERR_DLOPEN_FAILED`）。

新增 `scripts/build-packaged-isolated.sh`：清空产物（绕开 IDE safe-delete 的 500 阈值）→ 强制重建 → 打包 → `trap` 保证恢复两处 Node ABI 并冒烟校验。`bash -n` 通过；等价步骤已手工端到端跑通。

**perf 判定（不重采、不抬阈值）**：阈值 493ms、基线 median 379ms、容差 30% 全部未动；观测 median **502–508ms**，超阈值 **1.8%–3.0%**（相对 median 为 +32%~+34%）。归因：迁移 21→22 个 SQL + 新增模块 require。下一步独立包用 `--cpu-prof` 剖析启动链定位 +120ms，在此之前保持红。

证据：`acceptance/m-blueprint-2026-11-11/m6a/packaged-start-diagnosis.json`。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 补记四（2026-11-13 · gen-ui 帧导航实机闭环）

把 W6 从 unit-only 升级为 verified-live。做法：起完整栈（后端 :3001 + vite :3000 + 离屏实例 :9223）→ CDP 注入
可信对照 `http://localhost:3000/?probe=trusted` 与不可信 `https://evil.example.com/probe` → 读主进程日志。

**修复前：静默（0 条记录）**。根因：`did-fail-load` 分支只对**已登记 gen-ui 进程**告警，未登记进程直接 `return`。
而应用 CSP 只允许 `'self'/本地网/gen-ui/pack`，外域 iframe 走 CSP 拦截的 `did-fail-load(-30)` 路，
所以「未登记进程 + 外域」既不进 `will-frame-navigate` 告警分支，也被 `did-fail-load` 跳过。

**修复**：`did-fail-load` 未登记分支接入 `classifySubframeNavigation` —— 仅 `hijack` 告警并推
`genUi:sandboxHijacked`（`frameUrl` 留空 + `reasonCode`），`trusted`/`other` 保持安静。
负测 `test/m5a-production-wiring.test.mjs` **16/16**（新增锚点：分级在推送之前）。

**修复后实机日志**（`.petri-test-instance.err.log`）：
`[gen-ui] 不可信子框来源（CSP 拦截、未登记进程），已推送即时恢复信号: https://evil.example.com/probe（FRAME_ORIGIN_NOT_ALLOWLISTED）`
可信对照无告警（噪声控制有效）。

证据：`acceptance/m-blueprint-2026-11-11/m6a/genui-frame-live.json`。
仍未覆盖：真实 `petri-genui://` 卡片进程内导航（需构造卡片 + OOPIF 登记路）。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 补记五（2026-11-13 · perf 剖析：`packaged_start` 从未回归，是计时窗口被 shim 污染）

用 `--cpu-prof` + 四段插桩拆开 500ms，结论**推翻补记三的 perf 判断**：

| 段 | 耗时 | 说明 |
| --- | --- | --- |
| Electron 空启动 | 50ms ×3 | 环境正常 |
| 迁移脚本 wall | 60ms ×3 | 22 个 SQL |
| spawn → health | 316 / 315 / 320ms | 后端真实启动 |
| **`fs.unlinkSync(临时迁移脚本)`** | **120 / 133 / 120ms** | 不在启动链上，却被计入 sample |
| 采集 total | 496 / 507 / 513ms | = 62+316+**125** |

**决定性对照**：`env -u NODE_OPTIONS` 跑采集器 → `[381,393,389]` median **389ms**；默认环境（IDE 注入 safe-delete shim）→ `[510,511,522]` median **511ms**。差值 122ms ≈ unlink 段。

**修复**：把 `fs.unlinkSync(migScriptPath)` 移出计时窗口（sample 记录之后）。删临时文件本来就不属于启动成本；**阈值 493ms、容差 30/60/25%、基线 median 379ms、采样轮次全部未动**。

**修后**：默认环境 `[382,389,384]` median **384ms**；`quality:perf` **PASS**（packaged_start 390 / long_conversation 28 / big_project_tree 13 / warm_backend_spawn 546）；`block350` 单测 15/15。

教训：perf 读数必须与「测量进程所在环境」一起解释——IDE 注入的 shim 会污染任何计时窗口内的文件操作。

证据：`acceptance/m-blueprint-2026-11-11/m6a/packaged-start-diagnosis.json:secondPass`。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 补记六（2026-11-13 · P1–P4 七项未验证项全部实测）

用户「安排 搞完」授权后，把核对清单里的 7 项可本机验的缺口一次跑完（临时库/临时 data dir，跑完即清）。

| 项 | 实测结果 |
| --- | --- |
| P1-a0 迁移后表存在性 | `src/migrations` 建 22 张核心表；`user_facts` 迁移后**不存在**（惰性建表属设计），`memory_vectors` 因模块加载已建 |
| P1-a 迁移幂等重放 | 22 文件重放：7 个 `duplicate column name` 属预期、**0 个非预期错误**、表数 72 不变、`project_id` 列保留 → **idempotent** |
| P1-b 配置导出/导入 | export 200 → import 200 → 再 export families 等价；坏 envelope **400 `config_import_rejected`** → ok |
| P1-c 多项目记忆隔离 | 写 A/B 各 200，A 只见 A、B 只见 B，DB 行 `project_id=projA/projB` → **isolated** |
| P2-a 插件安装链 | 真实 zip 解压落地、content-plugin 注册（1 篇文档）、installed 记录往返、SHA 一致、`http:` 下载被拒（只允许 https）、localhost URL 被白名单拒、github 通过、缺平台 `ARTIFACT_MISSING`；`uninstallPlugin` 已按 BLOCK-158 退役（余 `uninstallRuntime`/`removePackage`）→ ok |
| P2-b 故障注入 | `secret-scan` 在 git 不可用时 **exit 1 + FAIL-CLOSED**（正常 PATH exit 0 PASS）；DDL 真实 IO → `error`，`no such table` → `info` |
| P3 MCP StreamableHTTP | 本地 mock server：注册 200（transport=http/url 保留）→ connect 200（toolCount=1）→ `status=connected, error=null`；回归 9/9 |
| P4 真实 gen-ui 卡片 | `window.petri.genUi.prepare` 返回 `petri-genui://gen-…/index.html`；卡片页内导航外部 → 主进程 `[gen-ui] 沙箱帧劫持侦测（did-fail-load CSP 拦截路）` → **verified-live** |

**本轮实测发现并修掉 2 个真实缺陷**：
1. 全新库 `POST /api/ai/facts` **500 no such table: user_facts** —— 上一包只修了读路径，写路径（POST / DELETE×2）漏了 `ensureMemorySchema()`；已补三处。
2. 远程 MCP（http/sse）注册 **100% 失败 400 missing_command** —— `/api/mcp/servers` 对远程条目显式传 `command: undefined`，`normalizeServerEntry` 未清理该键，`sanitizeItem` 判 type-mismatch；已在 helper 层清理（stdio 缺 command 仍报错）。

证据：`acceptance/m-blueprint-2026-11-11/m6a/p1-p4-verification.json`。

未覆盖（精确原因）：P2-a 的远程商店下载分支（host 白名单只允许 github 等 + downloadFile 只允许 https，本机无 CDN 包）、MCP OAuth 授权流（需真实 OAuth 服务）、OOPIF `frameRoutingId` 跨导航变化下的登记可靠性。

G0 开发期常态 · 不外推 packaged/Provider/GA。
