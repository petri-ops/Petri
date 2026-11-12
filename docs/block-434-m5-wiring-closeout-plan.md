# BLOCK-434 · M5 判据层→生产路径接线收尾

> 前置：M5（BLOCK-431）八类安全判据已全部落地为纯模块 `security-boundaries.js`，但**判据未接到生产路径**
> （M5 证据里 8 项均标 `done-partial`，补腿条件=生产接线）。本包只做「把已有判据接到真实调用点」，
> 不新增判据、不改判据语义、不动任何既有裁决。
> 依据：`acceptance/m-blueprint-2026-11-11/m5/m5-evidence.json:deliverables[].closureCondition`。

## 范围（4 项真实缺口，逐项单一文件、可单测）

| ID | 缺口（现读实证） | 接线点 | 判据来源 |
| --- | --- | --- | --- |
| W1 | `scripts/secret-scan.mjs:67` `catch { continue }`——git grep 的 ENOENT/128 等真实故障被当作「无命中」静默跳过，密钥扫描可假绿 | `scripts/secret-scan.mjs` | `adjudicateGitGrepResult` |
| W2 | 全局 Origin 门未挂载：`requireTrustedDesktopOrigin` 只挂在 `routes/files.js` 若干路由，其它写面（settings/memory/pack/session…）对浏览器跨源请求无统一拒绝 | `core/petri-server/bootstrap.js` | `isTrustedDesktopOrigin`（既有） |
| W3 | `routes/ai-memory.js:13-42` 四处 `catch {}` 吞掉 DDL 失败，迁移失败与「列已存在」不可区分 | 新增 `helpers/ddl-migrate.js` + 接入 | `ddlOutcome` / `redactLog` |
| W4 | `src/plugin/zip.js:47-91` 解压中途失败（条目越界/软链/超限）后留下半成品目录，下次安装读到脏 dest | `src/plugin/zip.js` | `cleanupPlan` |

## 关键设计约束

- **W2 只做「有 Origin 但不可信 → 403」**：无 Origin 的调用方（curl / 本地脚本 / 既有 Node 测试）语义**完全不变**，
  不引入新 token 前置条件（避免打破既有裁决与测试面）；已挂 `requireTrustedDesktopOrigin` 的路由保持原样（更严格）。
- **W3 保持启动韧性**：DDL 失败不抛（迁移在模块加载期），但必须**结构化可见**——按 `ddlOutcome` 分类
  （`DDL_FAILED` vs 预期内的「列已存在」），非预期失败用 `redactLog` 脱敏后落 `console.error` 并入模块级
  `ddlIssues` 数组供测试/健康面读取。
- **W4 只清理本函数创建的 dest**，不删调用方传入的其它路径；清理用 `fs.rmSync(dir, {recursive:true, force:true})` 且失败不掩盖原始错误。
- 零新增依赖；不改 `workspace_exec` 默认放行、`MAX_AGENT_ITERS=Infinity`、ADMISSION/FK/MCP 计量/主题/中栏裁决。

## 验收门

- `node --test test/m5a-production-wiring.test.mjs`（HK-01：先红后绿，含 5 项篡改/边界负测）。
- `npm run quality:lint`（新代码 0 新增违规）、`npm run quality:arch`、`npm run quality:secret`。
- `npm run test:changed -- --run`、`npm run closeout`（当次读数如实登记）。
- `npm run docs:check` / `npm run docs:reconcile`。

## 完成语义

W1–W4 各自「判据已接生产路径 + 负测覆盖」= `done`；**不宣称 M5 全 8 项已接线**（drag / MCP 白名单 / 帧导航
需新增 IPC 通道或改主进程装配，触碰在制 WIP 边界，继续留 `done-partial`）。未达项如实登记，不升级措辞。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 收口笔录（2026-11-11 · BLOCK-434 / COMPLETED，4 项 done + 3 项仍 done-partial）

**交付（判据层 → 生产路径接线，不新增判据）**

- **W1 `scripts/secret-scan.mjs`**：`catch { continue }` 改为消费 `adjudicateGitGrepResult`——只有 exit 1 且 stderr 空算「无命中」，ENOENT/128/-1/stderr 非空一律 **fail-closed**，`main()` 打印 FAIL 并 exit 1。此前 git 故障会让密钥门静默假绿。
- **W2 `core/petri-server/bootstrap.js`**：`rejectUntrustedOrigin` 挂到 `setupBootstrap`（requestId 之后、业务路由之前）。规则只拦「**真实 http(s) 且不可信**」来源；无 Origin 放行；`Origin:'null'`/file:// 交各路由 token 门裁决。
- **W3 `core/petri-server/helpers/ddl-migrate.js`（新增）+ `routes/ai-memory.js`**：六条迁移 DDL 收口到单一入口，按 `ddlOutcome` 分类 applied / suppressed / failed；failed 用 `redactLog` 脱敏后落 stderr 且不抛；结果经 `module.exports.ddlMigration` 可读。原四处裸 `catch {}` 清零。
- **W4 `src/plugin/zip.js`**：解压失败先清理本函数创建的 destDir 再原样抛错，不再留半成品目录。

**负测（HK-01 先红后绿）**：`test/m5a-production-wiring.test.mjs` **8/8**，覆盖 5 种 git 故障码、403 三形态（外部站/回环非白名单/无 Origin 放行）、DDL 三分类、zip 失败清理与不误删。

**自纠**：W2 初版拦所有非可信 Origin（含字符串 `'null'`），会破坏 BLOCK-67「Origin:null + token → 200」拖出下载语义；改为仅拦真实 http(s) 后，`test/block67-routes.test.mjs` **9/9** 回归通过。

**门禁实况（不写全绿）**：改动 5 文件 lint **0**；`quality:arch` PASS、`quality:secret` PASS、docs:check 579、docs:reconcile **0 issues**；`test:changed` **1684 tests / 2 fail / 11 skipped**（两红仍为 UI-629 与 P6，均 W 类在制 WIP，接线未引入新红）；`closeout` **exit 1**（第 5 门拦停，前 4 门 PASS、后 13 门未执行）。

**仍 done-partial（如实登记，不冒充八项全接线）**：M5-3 drag 登记根（需新增 IPC 通道 + preload 包装，触碰契约面与 UI 拖放链路）、M5-2 MCP command 白名单（真实 spawn 点不在 routes/mcp-client.js，需定位 core/mcp 执行链）、M5-4 帧导航 allowlist（落在主进程装配 + 需 9223 离屏实机腿）。逐项补腿条件见 `m5a-evidence.json:stillDonePartial`。

**范围守住**：零新增依赖 / 零放宽基线 / 零触碰在制 WIP / 零 stage 零提交 / 零撤销既有裁决（`MAX_AGENT_ITERS=Infinity`、`workspace_exec` 默认放行、`Origin:null`+token、主题、中栏）/ 零 G1+ 外推。

**证据**：`acceptance/m-blueprint-2026-11-11/m5a/`。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 补记（2026-11-11 · MCP stdio 接线，第 5 项）

用户追加「一次性做完剩余项」后补做 **W5 = M5-2 MCP 命令白名单接线**：

- **真实 spawn 点已定位**：`core/petri-server/mcp/client-manager.js:new StdioClientTransport`（此前误记为 `routes/mcp-client.js`，该文件无 spawn）。
- **接线内容**：新增纯函数 `adjudicateStdioConfig` 并在 spawn **之前** 调用——
  ① **注入硬化恒生效**：command/args 含 shell 元字符（`;` `&` `|` `$` 反引号）一律拒；
  ② **命令白名单显式生效**：`PETRI_MCP_COMMAND_ALLOWLIST` 设置时按清单 fail-closed。
- **为何白名单不翻默认**：把默认集合收窄为 `node/npx/python3` 会改变产品能力面（生态常见 `uvx`/`bun`/`docker`），属 **U 类**，按纪律不静默启用，需用户裁决后再翻默认。未设 env 时保持既有语义，回归面（任意已装命令可用）不破。
- **负测**：`test/m5a-production-wiring.test.mjs` 增至 **10/10**（新增 2 项：四类边界 + "判据必须在 spawn 之前" 的源码顺序断言）。
- **口径修正**：本包结论由「4 项 done」修正为 **5 项判据接线（4 项 done + 1 项 done-partial 带 U 类待裁决）**；剩余未做项由 3 项收敛为 **2 项**（drag 登记根、帧导航 allowlist）。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 补记二（2026-11-11 · 帧导航接线 W6 / drag 定性）

**W6 = M5-4 帧导航接线（done）**：真实侦测点在 `src/main/security-hardening.js` 的
`will-frame-navigate` / `did-frame-navigate` / `did-fail-load` 三路。**实测约束**：BLOCK-168 P1-A 已
证实 `preventDefault` 对子框导航无效，故本项**不假装能拦**，只把判据 `adjudicateFrameNavigation`
接成「分级 + 告警」——`genui` / `trusted`（回环白名单单源复用 `trustedDesktopOrigins`）/ `hijack` / `other`。
改进点：此前只有登记表命中（进程内离开 gen-ui 作用域）才告警，**未登记进程的不可信 http(s) 来源静默通过**；
现在 `hijack` 且无登记时也推 `genUi:sandboxHijacked`（`frameUrl` 留空，不带原帧信息）。
负测：`test/m5a-production-wiring.test.mjs` 增至 **12/12**（四类分级 + userinfo 必红 + 侦测路已消费判据 + 事实说明保留）。

**M5-3 drag 登记根：定性为 U 类，不接线（诚实边界）**。三条硬事实：
1. `adjudicateDragPath` 要求 `registeredRoots` 命中，而拖入的两个真实用途——`fs/import-from`（从桌面任意路径导入）
   与「拖目录建项目」——**源路径按设计就在已登记根之外**，套用即全量拒绝，属功能破坏；
2. 判据的 `MAX_DRAG_BYTES = 20MB` 与 `fs/import-from` 的「无 1MB 上限、目录递归」显式设计冲突；
3. 真正需要收窄的是「拖入源是否允许任意路径」这一**产品问题**（安全 vs 可用性），需用户裁决，不是机械接线。
补腿条件：用户裁决后（如限定为「用户主目录 + 已登记工作区根」），新增 `adjudicateDragSource` 判据并在
`fs/import-from` 与「拖目录建项目」两处接线，带目录/软链/体积负测。

**口径**：判据接线 6 项（5 done + 1 done-partial/U=W5 MCP 白名单默认值），drag 1 项 U 类待裁决。

G0 开发期常态 · 不外推 packaged/Provider/GA。
