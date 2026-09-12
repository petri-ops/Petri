# BLOCK-84-DOMAIN-PACK-ONECLICK：领域包产品级一键装/卸计划

> 文档版本：v1.2（P1+P2+P3 收口版）
> 创建日期：2026-09-12
> 状态：**active（P1+P2 已收口 · P3 收口已执行，1 项门禁失败经基线证明为存量债）**
> truthDomain：block-84-domain-pack-oneclick
> 上游：BLOCK-83（已 completed——本包把「环境变量级拔插」升级为「产品级一键」）
> 收口证据：`acceptance/block-84/block84-pack-oneclick-live.json`（P1 隔离探针双态 20/20）
> · `acceptance/block-84/block84-p2-ui-live.json`（P2 CDP 商店 UI 6/6）
> · P3 聚合门禁 `npm run closeout` 3/4 PASS（第 4 项存量债，见 §9.2 逐位对照）

---

## 1. 用户裁决与目标

用户裁决（2026-09-12，原话）：**「是的 需要 产品级 一键」**——领域包的安装/卸载要从环境变量级（开发者体验）升级为产品级 UI 一键操作。

**目标形态**：插件商店内「领域包」分区——每个包一张卡片（名称/版本/提供物/状态），**一键安装 / 一键卸载**，卸载即回到纯通用态（核心零改动，BLOCK-83 已验收的语义）。

## 2. 现状与设计裁决

**现状**：装/卸 = 手工设 `BIOF3_PLUGINS_DIR` + `BIOF3_DOMAIN_TOOL_REGISTRY` 两个 env + 重启；核心五插座已全部就绪（BLOCK-83 P3/P4）；插件商店已有完整插件级安装管道（`plugin:*` 8 IPC + PluginStorePanel + plugin-manager）。

**设计裁决**（机制级，内部裁决；产品可见项见 §3）：

- **D1 安装记录**：`<dataDir>/packs/installed.json`（数组：`{packId, packRoot, version, installedAt}`）——文件制、additive、与插件 `installed.json` 先例同构；dataDir=`BIOF3_LOCAL_DATA_DIR`。
- **D2 包来源（v1）**：本地目录选择（主进程 `dialog.showOpenDialog` 选含 `pack.json` 的目录）+ 兄弟仓自动发现（`../gewu-pack-bio`，dev 便利）；**远程分发 defer**（插件级 remote manifest 机制在，包级远程另立候选）。
- **D3 boot 接线**：server 启动时读 packs 记录 → 每个已装包追加 `{type:'installed', root:<pack>/plugins}` 插件源 + `toolRegistry.registerDomainToolsFile(<pack>/registry/tool-registry.json)`。**tool-registry 从「env 单文件」升级为「env + 命令式注册可叠加」**（内部 map 可变，导出函数不变——消费方零改动）。
- **D4 卸载语义**：移除安装记录 + 诚实提示「重启后生效」（plugin-loader 单例，与运行时安装的重启先例一致）；**不删包文件本身**（包是用户资产）。
- **D5 包校验**：安装时校验 `pack.json`（packId 必填 + plugins/installed.json 存在）；重复安装 = 幂等更新。

## 3. 交付面

| 层 | 内容 |
| --- | --- |
| 主进程 | `core/shared-backend/pack-registry.js`（记录读写 + pack.json 校验 + 兄弟仓发现）<sup>[1]</sup> + `src/ipc/pack.js`（`pack:list-available` / `pack:list-installed` / `pack:install-from-dialog` / `pack:install-path` / `pack:uninstall`）+ preload `packs.*` 桥 |
| server boot | `server.js` 读 packs 记录 → 插件源追加 + tool-registry 文件注册（additive，零包=零行为） |
| UI | `PluginStorePanel` 增「领域包」分区（卡片：packId/name/version/provides 摘要/状态/按钮 + 重启提示） |
| 工具注册 | `tool-registry.js` 增 `registerDomainToolsFile()`（导出面 additive） |

<sup>[1]</sup> 路径修正（2026-09-12 P1 收口）：立项版写的是 `src/pack-registry.js`，
实现落在 `core/shared-backend/pack-registry.js`。选 core 侧的原因：boot 侧
`core/biof3-server/server.js` 与主进程侧 `src/ipc/pack.js` **都要** require 同一份实现，
放在 core 里两侧都是同层相对引用；放 `src/` 则 server.js 要跨出 core 边界反向依赖
Electron 主进程目录。当前实现与测试均按 core 路径（`test/block84-pack-oneclick.test.mjs`、
`src/ipc/pack.js:11`、`core/biof3-server/server.js:72` 三处一致）。

## 4. 阶段

- P1 后端（pack-registry + IPC + boot 接线 + tool-registry 叠加注册）+ 契约测试
- P2 前端（商店领域包分区）
- P3 实机验收（装→catalog=15→卸→catalog=0 双态循环 + D13 夹具同样可装）+ 收口

## 5. 范围外

- 远程包分发（候选）；包内单插件粒度管理（插件商店已有）；自动更新；多包冲突仲裁（v1 单包为主，多包叠加按注册顺序）。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 验收门禁预声明

- 契约测试（pack-registry 读写/校验/幂等/tool-registry 叠加）全绿 + tsc 0 + docs/ui 门禁。
- 实机（dev 栈重启循环或隔离探针）：装 gewu-pack-bio → catalog=15 → 卸 → catalog=0；D13 夹具第二租户同法可装可卸。
- 卸载后核心零残留（复用 BLOCK-83 Z4 文件级检查语义）。

---

## 7. P1 收口记录（2026-09-12）

**结论**：P1 后端 + 契约测试**已收口**。证据 `acceptance/block-84/block84-pack-oneclick-live.json`（**20/20 ALL PASS**）。

| 断言组 | 覆盖 |
| --- | --- |
| P4a–P4c | 零态诚实：无记录 → 无接线、catalog 诚实为 0、无错误 |
| P1a–P1c | 安装幂等 upsert + 单条记录 |
| P2a–P2d | 接线生效：插件源追加 + catalog=15 + source=installed-plugins |
| P5 | catalog 投影字段完整性（`pluginDir` 非空——防 `getToolDefinition` 崩） |
| P3a–P3c | 卸载只移记录、**包文件保留** |
| P4d | 卸载后回到零态 |
| P6a–P6c | D13 第二租户：现场合成非生信包可装可卸（领域中立性） |

**P1 期间发现并修复的真缺陷（3 项）**：

1. **`loadFromSourcesArray` 丢运行时装配字段** —— 只 `map.set(id, manifest)`，缺 `pluginDir`/`scriptPath`/`_sourceType`。
   后果：`getToolDefinition` 读 `plugin.pluginDir` 得 `undefined` → `path.join` 抛
   `ERR_INVALID_ARG_TYPE` → `getAllPluginManifests()` 崩 → `GET /api/tools/catalog` **恒 500**。
   **隐蔽点**：装载计数日志仍打印 `loaded 15 plugin(s)`，装载与目录投影是两条独立链路，
   缺陷被日志掩盖。修复：对齐 `loadPluginsFromSources` 的装配语义（P5 锁死）。
2. **路径漂移** —— `core/biof3-server/server.js:72` 指向不存在的 `src/pack-registry.js`。已修为
   `core/shared-backend/pack-registry.js`（见 §3 脚注）。
3. **调试残留** —— `plugin-loader.js` 遗留 `[block84-debug]` console.log，已删。

## 8. P2 收口记录（2026-09-12）

**结论**：P2 前端商店「领域包」分区**已收口**。证据 `acceptance/block-84/block84-p2-ui-live.json`（**6/6 ALL PASS**）。

| 断言 | 结果 |
| --- | --- |
| U1 页面可达 | PASS |
| U2 商店页可达且非错误屏 | PASS（`errorScreen=false`） |
| U3 「领域包」分区可见 | PASS（`sectionExists=true`） |
| U4 包卡片存在 | PASS（`domain-pack-gewu-pack-bio`） |
| U5 桥数据与分区渲染一致 | PASS（`bridgeInstalled=1`） |
| U6 「重启生效」诚实提示 | PASS |

**P2 期间发现并修复的真缺陷（1 项主缺陷 + 1 项环境根因）**：

1. **IPC 契约漂移（前端把 `{ok, packs}` 当裸数组）** —— `PluginStorePanel.refreshPacks()`
   的 TS 声明为 `Promise<InstalledPack[]>`，直接把返回值 `setState`。但 IPC 实际返回
   `{ok:true, packs:[...]}`（与 `installPath`/`uninstall` 的 `{ok, error}` 同族）。
   后果：state 被塞进普通对象 → `installedPacks.length === undefined` →
   `length > 0` 恒 false → **分区永不渲染**（数据链路全通却看不见卡片）。
   修复：加 `unpackPacks()` 归一化（兼容裸数组与信封两种形态）。
2. **环境根因：dev 渲染器 origin 白名单缺 `127.0.0.1` 变体** —— dev 模式
   `backendPorts.renderer` 恒为 `null`（见 `_backend-ports.js`），白名单只能由
   `rendererDevUrl` 推导，旧实现只 `add(new URL(rendererDevUrl).origin)` 一个值。
   页面一旦跑在 `127.0.0.1:3000`（`vite.config.ts` 显式 `host:'127.0.0.1'` 后即如此）
   就命中 untrusted origin → 后端响应缺 `Access-Control-Allow-Origin` → **浏览器丢弃
   那个 200** → 渲染进程 `fetch` 抛 `TypeError: Failed to fetch` →
   `project-store.getProject` 的 `catch` 吞错返回 `null` → 全屏
   **「项目不存在或无权访问」**（文案与真实原因完全无关，极具误导性）。
   修复：抽出纯函数 `computeTrustedRendererOrigins()`，dev 下写入
   `localhost` / `127.0.0.1` **双变体**；新增契约测试
   `test/env-coordinator-trusted-origins.test.mjs`（7 断言，含真实消费方
   `local-request-boundary` 的集成断言）。
   **诊断难点**：CDP `Network.responseReceived` 能看到 200，只有渲染进程 `fetch` 会失败——
   纯静态推理或"看看网络面板"都会得出"后端正常"的错误结论，必须实地跑渲染进程侧 fetch。

**顺带偿还的测试债**：`test/env-coordinator-port.test.mjs` 用 `import(path.join(root, ...))`
传 Windows 绝对路径，Node 把 `d:` 当未知 scheme 抛 `ERR_UNSUPPORTED_ESM_URL_SCHEME`——
**该套件在 Windows 上从未真正执行过**。改用 `pathToFileURL().href` 后 5/5 全绿。

**P2 验收方法学（写进脚本头注释，供后续复用）**：
- origin 必须用 `http://localhost:3000`（与后端白名单口径一致）；
- 导航必须用 CDP `Page.navigate` 软导航 —— `location.href` 硬导航会触发欢迎页
  auto-navigate，把 URL 弹回 `allProjects[0]`（很可能是不可达的 ssh 项目）；
- 必须选 `workspace_kind='local'` 项目 —— ssh 项目远端不可达时工作区加载失败，
  同样看不到商店页。

## 9. P3 正式阶段收口记录（2026-09-12）

**结论**：P3 收口已执行。聚合门禁 `npm run closeout` 4 项中 **3 项 PASS**（工作区卫生 / 文档治理 / UI 台账），第 4 项 `test:changed` **FAIL(exit 1)**，经**逐文件基线对照证明为存量测试基建债、BLOCK-84 引入 0 个新失败**。

### 9.1 收口过程中的两项真实修复

1. **`scripts/test-affected.mjs` 硬依赖外部 `rg`（门禁无法收口的真根因）** —— `listScripts()` 用
   `execFileSync('rg', ['--files','scripts'])` 枚举脚本树，未安装 ripgrep 的机器上抛
   `spawnSync rg ENOENT` → `npm run test:changed` / `npm run closeout` **必然 exit 2**。
   修复：改用仓库既有硬依赖 git（`git ls-files` + `--others --exclude-standard`）枚举，
   顺带覆盖未跟踪文件，跨机可复现。**`rg` 的 ENOENT 此前一直在掩盖真实的脚本分类缺口**。

2. **`test/impact-map.json` 4 个脚本零分类（rg 修复后暴露出的真实门禁缺口）** ——
   `scripts/block84-p2-ui-live.cjs` / `blocks84-pack-oneclick-live.cjs` / `tmp-block84-probe.cjs`
   归属 `block84-domain-pack-oneclick`（该规则 `classifiesScripts: false → true` +
   补 `scripts/tmp-block84-probe.cjs` 显式 pattern）；`scripts/tmp-d13-probe.cjs`
   归属既有 `block83-general-agent-base`（被 `block83-p4-exit-live.cjs` 正式引用）。
   修后 `npm run test:changed:list` exit 0，plan **53 files / unknown = 0**。

### 9.2 `test:changed` FAIL 的归因（存量债，非本包引入）

**方法**：53 个受影响文件**逐文件单跑**，统计固有失败 → 与批次模式失败数比对 → 再对 HEAD 基线（`git stash` 掉 BLOCK-84 全部 WIP）跑同一组文件比对。

| 测试文件 | HEAD 基线失败 | BLOCK-84 WIP 失败 | 判定 |
| --- | --- | --- | --- |
| `test/g0-rs-p6-product-acceptance.test.mjs` | 7 | 7 | 存量（P6 evidence fail-closed） |
| `test/g0-chf0-science.test.mjs` | 7 | 7 | 存量 |
| `test/result-replay-service.test.mjs` | 6 | 6 | 存量 |
| `test/capability-bundles.test.mjs` | 3 | 3 | 存量 |
| `test/tool-job-conversation.test.mjs` | 3 | 3 | 存量（`D:\D:\` 双根路径反模式） |
| `test/agent-approval.test.mjs` | 2 | 2 | 存量 |
| `test/agent-run-tool.test.mjs` | 2 | 2 | 存量 |
| `test/result-selection-tools.test.mjs` | 1 | 1 | 存量 |
| `test/terminal-multisession-ipc.test.mjs` | 1 | 1 | 存量 |
| `test/tools-executor-job-context.test.mjs` | 1 | 1 | 存量 |
| **合计** | **33** | **33** | **逐位一致 → 0 新增** |

**三条关键证据**：

1. **逐文件基线 == 批次失败数（33 == 33）** —— 证明 33 个失败**全部是文件级固有失败**，
   不存在并发/时序放大（此前的第一批 38 个失败中的 ABI 类已由运行时对齐消除）。
2. **HEAD 基线逐位一致** —— 10 个文件在无 BLOCK-84 改动时失败数完全相同，**本包引入 0 个新失败**。
3. **BLOCK-84 自身 6 个套件全绿** —— `block84-pack-oneclick` 5/5、
   `env-coordinator-trusted-origins` 7/7、`env-coordinator-port` 5/5、
   `plugin-manifest-schema` 1/1、`domain-neutrality` 2/2、`plugin-sdk` 4/4。

**附：一次运行时误判的排除记录** —— 首次 `closeout` 出现 38 个失败，根因是 shell PATH 中
`node` 指向系统 **Node v22.22.2**，而 better-sqlite3 原生模块按 **Node 24 ABI** 构建 →
db 触碰型套件 `ERR_DLOPEN_FAILED` 整文件失败。切到 `fnm` 的 **Node 24.20.0** 后该类失败全部消失。
**教训**：本仓测试门禁必须在 Node 24 下执行（项目记忆既有条目，本次再次实证）。

### 9.3 P3 收口结论

- 阶段门禁记录：**`closeout` 3/4 PASS**，第 4 项失败已如实归因为存量测试基建债并给出逐位对照证据，
  未把未跑/失败门禁表述为通过。
- 存量债处置：33 项归入既有 AUDIT-LOG 🟢 条目「better-sqlite3 ABI 漂移 / Windows 路径反模式」所属的
  **测试基建清债节奏**，经用户裁决后并入，不阻塞 BLOCK-84。
- P1（20/20）+ P2（6/6）实机证据保持有效。

### 9.4 P3 门禁终态对账（2026-09-12，Node 24.20.0）

| 门禁 | 结果 |
| --- | --- |
| `npm run hygiene:check` | **PASS**（无死符号链接 / 无残留 / 无换行漂移；9 项 untracked 为 BLOCK-84 WIP） |
| `npm run docs:check` | **PASS (232 registered documents)** |
| `npm run ui:audit:check` | **PASS**（312 个带实现证据的 UI 编号同步） |
| `npm run test:changed:list` | **PASS**（exit 0 · 53 files · unknown **0**） |
| `npm run test:changed` | **FAIL(33)** —— §9.2 逐位对照证明 33/33 为存量债，本包引入 **0** |
| `frontend / tsc --noEmit` | **0 错** |
| `frontend vitest usePluginStore` | **9/9 PASS** |
| `npm run verify -- app-health` | **4/4 allPass**（CDP 可达 / SPA 挂载） |
| `npm run verify -- block83-tool-catalog` | **8/8 allPass** —— `C2` 返回 `count=15, source=installed-plugins`，**端到端实证领域包已装载并投影到工具目录** |
| `scripts/block84-pack-oneclick-live.cjs` | **20/20 ALL PASS**（P1 隔离探针双态） |
| `scripts/block84-p2-ui-live.cjs` | **6/6 ALL PASS**（P2 CDP 商店 UI） |

**G0 开发期常态 · 不外推 packaged/Provider/GA。**
