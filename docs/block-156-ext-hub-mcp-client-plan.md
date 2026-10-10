---
capability: extensions-hub-mcp-client
goal: 把现有生信垂直的插件+技能归位到「领域扩展」货架，新增「通用技能」与「MCP 服务」两类通用 agent 扩展，并为通用 agent 补上 MCP 客户端引擎（连接第三方 MCP server、工具投影进内置 agent 循环）
acceptance:
  - P0 勘察结论落盘本 plan §3（八组勘察事实 + 决策点 D1-D7），实现动手前经用户确认
  - P1 扩展中心货架重组：前端四货架（领域插件/领域技能/通用技能/MCP 服务）+ 旧路由重定向 + LeftPanel/AppRail 入口收敛 + skill category 归类规则 + marketplace 残迹清理；组件/路由定向测试 + theme 门禁 + 实机 CDP 断言（货架在场/切换/深链重定向）证据落 acceptance/block-156/
  - P2 MCP 客户端基座：channels.js 登记 mcp:* 通道族 + preload 包装 + 连接管理器（stdio）+ 配置持久化 + 扩展页/设置面 UI；连接生命周期测试 + ipc-channels-registry 双向守护 + 实机断言（以自家 petri-mcp stdio server 为回环被连对象，connect→listTools→disconnect）
  - P3 工具投影与审批策略：第三方工具按 mcp_<server>_<tool> 命名空间投影进 agent-tools 注册表（每工具声明 contract sideEffect/riskTier）+ 复用 agent-tool-policy 档位闸（不开第二套权限系统）；投影契约测试 + policy 档位测试 + block109-p2 恒等对账 + 实机 agent 会话调用 MCP 工具断言
reopen: 用户裁决货架分类学回摆（领域/通用边界变化）或 MCP 客户端方向变化时
status: completed
---

# BLOCK-156 — 扩展中心重组与 MCP 客户端（整包 completed）

> 立项：2026-10-10（P0-LAUNCH）。用户方向裁决（原话见 §1）确认「领域/通用」两分扩展分类学与 MCP 客户端必要性。
> **收口：2026-10-10 同日整包 completed**（用户裁决「全按推荐 搞完」= D1-D7 全推荐 ⓐ + 三阶段一次会话连打；P1 1842c2ee（含 amend：git mv 半程致 skills/ 旧路径四件双份化石清理，worktree 一直正确）/ P2 7d4f9f97 / P3 7599abc5，收口笔录见 §8）。
> 能力：`extensions-hub-mcp-client`。

## 1. 一句话目标与裁决来源

现有插件（PluginStorePanel）与技能（SkillsPage）都属生信垂直能力，归并为**领域扩展**货架；新增**通用技能**货架（不绑领域的方法论，coding-playbook 已是既成实例）与 **MCP 服务**货架（第三方 MCP server 接入，应用作为 MCP client），让格物作为通用 agent 补齐第三方扩展面。

**用户裁决（2026-10-10 原话）**：方向裁决「MCP客户端需要的 毕竟 petri是个通用 agent 怎么能不支持第三方的 mcp和skills呢」「目前的 插件和skills都属于生信垂直领域 应该合并归到领域中 新增 skills和mcp服务 对应通用agent」+ 节奏授权「行！ 按照你的节奏整」（=按主 Agent 提议的节奏：先归类重组、再上 MCP 引擎、P0 勘察报告先行、确认后进实现）。

**红线**：
1. 货架合并是**入口层/分类学合并**，不做插件与技能的代码层合并——RS descriptor 契约、plugin-loader、skill-registry 两条运行时保持原样。
2. MCP 服务独立货架不并入技能——信任边界（外部进程）与生命周期（配置+连接状态）不同，不混类。
3. 不开第二套权限系统：MCP 投影工具复用 agent-tool-policy 档位闸。
4. 范围外发现转候选池，不扩 scope。

## 2. 范围与非范围

**范围内**：① P1 扩展中心货架重组（前端 IA + 路由 + 入口收敛 + category 归类 + 残迹清理）；② P2 MCP 客户端基座（配置持久化 + stdio 连接管理 + IPC 通道族 + 配置 UI）；③ P3 工具投影与审批策略（agent-tools 新域 + policy 接线）；④ 每阶段定向测试 + 实机断言落 `acceptance/block-156/`。

**明确不做（非范围）**：MCP 对外 server 侧改造（`src/mcp-server.js` / `mcp/server.js` 保持现状）；领域包（pack）装卸机制重构——pack 机制原样保留，货架只重组展示入口；Result Studio 插件 descriptor 契约变更；marketplace 远程技能市场（D7 裁决 v1=本地导入，远程市场 deferred）；HTTP/SSE 传输（D3 裁决 v1=仅 stdio，见该条）；MCP 服务器侧 OAuth/鉴权流；G1+ 事项（G0 开发期常态 · 不外推 packaged/Provider/GA）。

## 3. P0 勘察结论（2026-10-10，只读探查代理 + 主 Agent 复核）

### 3.1 现有扩展面事实（勘察八组结论摘要）

1. **路由与入口**：`/skills`（App.tsx:149）、`/plugins`（:151）、`/settings`（:153）三个独立路由；入口按钮在 `LeftPanel.tsx` QuickActions（插件 puzzle :348-354、Skills sparkles :356-362、分组「工作台」），`AppRail.tsx:109-111` 与 `project-workspace.tsx:461` 各有一份 navigate 转发；home 页仅后端未就绪时的逃生通道入口（home.tsx:130-136、:355-359）。
2. **插件商店**：数据全走 `usePluginStore`（模块缓存+订阅）→ IPC `plugin:list-installed/list-remote/install/uninstall`；另有**领域包(pack)体系**（BLOCK-84，`useDomainPacks` → `pack:*` 通道族，三档卸载确认）——「领域」概念已有基建雏形；分类体系现仅 all/tool 两档（UI-374 把 runtime 收编进包卡片）；content-plugin 不进商店（独立文档通道）。
3. **远程清单**：`plugin/manifest-source.js` 拉取 `PETRI_PLUGIN_MANIFEST_URL`（缺省 OSS 常量，paths.js:75-77），15s 超时、失败静默降级为仅内置清单——远程清单模式已有成熟先例可参照。
4. **技能数据流**：桌面走 IPC `skills:discover/execute/progress/cancel`（`src/main.js:238-316` → skills-sdk → SkillRegistry），不走 HTTP；HTTP 投影仅移动端（projection-data.js:45）；installed 目录 = 用户数据目录 `$PETRI_USER_DATA_DIR/skills`（skill-registry.js:282-291）；**marketplace 只剩残迹**（SOURCE_PRIORITY:30、缓存字段 :48-50、MCP schema enum 遗留，无任何加载代码）。
5. **设置面惯例**：`DesktopSettingsPanel` 八分区（types.ts:15-43），新分区三步注册；持久化惯例 = JSON 文件（ai-settings.json 模式，core/petri-server/helpers/ai-settings.js）；IPC 链路样例 ai-settings（channels.js:15-21 → ipc/ai-settings.js → preload.js:213-219 → electron.d.ts → hook）。
6. **Agent 工具链**：`getToolDefs()`（tool-defs.js:47-51）→ registry `getProviderToolDefs()`（启动时 buildToolRegistry 三方一致性 fail-fast 校验，registry.js:431）→ agent-runner.js:655 `resolveToolDefsForContext` → 可选 BLOCK-113 两跳预路由收窄（:656-677，默认关）→ loopConfig.tools。**`⋃DOMAIN_TOOL_DEFS === TOOL_DEFS` 深度恒等契约被 block109-p2 测试钉住**（tool-defs.js:41-42），新增域必须保持。
7. **审批档位**：两层——会话 accessMode 四档（read/workspace-write/plan/full）；工具级 contract（sideEffect 五值 × riskTier R0-R3，R3 一律 deny）；**默认档由 sideEffect+riskTier 推导，无独立档位字段**——MCP 投影工具必须逐工具声明这两项；HEAVY_TOOLS 确认门是 run_tool 专属先例。
8. **IPC 新增纪律**：channels.js 值唯一且 `ns:event` 形、preload 字面量必配（或 MAIN_ONLY 白名单）、**新 IPC 文件必须加入 ipc-channels-registry.test.mjs 的 CONSUMERS 数组**（字面量回流闸），五道闸缺一即红。

### 3.2 关键风险（实现期护栏）

- **R1 工具注册表启动 fail-fast**：MCP 投影工具 defs/handler/contract 三方不一致 = 所有 agent 请求启动失败。护栏：投影层对连接失败/工具缺失降级为空集合，不阻塞内建工具注册。
- **R2 SDK ESM-only**：`@modelcontextprotocol/sdk` 是 ESM，CJS 侧必须动态 `import()`（先例 src/mcp-server.js:13-16）；连接管理器落点若在 core（CJS）沿用同法。
- **R3 预路由恒等契约**：新增 tool-defs 域文件必须汇入 TOOL_DEFS 汇编，否则 block109-p2 深度对账即红（正向守护，防漏不防多）。
- **R4 深链兼容**：/plugins、/skills 直链与三处 navigate 转发（AppRail/project-workspace/home 逃生通道）都要有归宿（fail-closed 重定向先例 UI-347）。
- **R5 skill category 归类零迁移原则**：现网 4 个内置技能 manifest 不改文件，归类在读取层判定（见 D2）。

## 4. 设计决策点（P0 评审 · 待用户裁决）

| # | 决策 | 选项 | 推荐 | 理由 |
|---|---|---|---|---|
| D1 | 货架路由形态 | a) 新增 `/extensions` 单页四货签，/plugins /skills 重定向到对应货签；b) 保留两页仅加分类；c) 保留两页+第三页 | **a** | 用户裁决的「合并归到领域」要求单一入口；重定向保深链（UI-347 先例）；入口三处收敛为一 |
| D2 | 领域/通用界定机制 | a) category 命名空间前缀规则（`bioinformatics/*` = 领域，其余 = 通用），读取层判定；b) manifest 加显式 scope 字段 | **a** | 零 manifest 迁移、向后兼容；现网 coding/playbook 天然落通用侧；b 留作 v2 演进 |
| D3 | MCP v1 传输范围 | a) 仅 stdio（本地子进程）；b) stdio+HTTP/SSE | **a** | 信任边界清晰、SDK 开箱、安全面小；HTTP/SSE（含鉴权）转 v2/deferred |
| D4 | MCP 投影工具默认档 | a) sideEffect=`external-request` + riskTier=R2 全档统一；b) 按 server 级配置放宽 | **a** | 复用现有档位闸零新增机制；R2 在 read/plan 档被禁、full 档可用，符合「外部第三方工具默认更严」；server 级信任覆盖 v1 不做 |
| D5 | MCP 配置持久化 | a) 独立 `mcp-servers.json`（复刻 ai-settings.json 模式，同数据目录）；b) 并入 ai-settings.json | **a** | 结构异构（servers 数组 vs 扁平设置）、生命周期独立（连接状态回写不复写用户设置） |
| D6 | 预路由收窄归属 | a) v1 MCP 工具不参与九域收窄（恒在工具集）；b) 新增 `mcp` 路由域 | **a** | 宁全勿缺是既有保守原则（tool-router 未知名保留）；新域要动决策配置中心，价值未证；b 留候选池 |
| D7 | marketplace 残迹与第三方技能 v1 | a) 清残迹（SOURCE_PRIORITY 值/缓存字段/MCP schema enum），第三方技能 v1=本地目录导入（文件对话框，复刻 pack installFromDialog 先例），远程市场 deferred；b) 留残迹等远程市场 | **a** | 残迹是死代码（质量门禁方向）；本地导入交付真实用户价值且信任边界简单；远程市场需清单基建另立项 |

## 5. 阶段划分与验收门禁

| 阶段 | 内容 | 验收门禁（收口逐项对账） |
|---|---|---|
| P1 扩展中心货架重组 | /extensions 四货签（领域插件=现商店基底/领域技能/通用技能/MCP 服务占位）+ 旧路由重定向 + LeftPanel/AppRail/project-workspace/home 入口收敛 + D2 归类规则 + D7 残迹清理 | 货架组件+路由重定向+入口收敛定向测试绿；theme-token-contract 4/4；tsc 0；ui:audit 台账同提交；实机 CDP 断言（四货签在场/切换/旧深链重定向三断言）证据落 acceptance/block-156/ |
| P2 MCP 客户端基座 | channels `mcp:*` 通道族 + src/ipc/mcp.js + preload 包装 + 连接管理器（stdio，动态 import SDK）+ mcp-servers.json 持久化 + MCP 货架签配置 UI（增删 server/连接状态/工具列表预览） | ipc-channels-registry 五闸绿；连接生命周期测试（connect/listTools/disconnect/异常降级）绿；持久化读写测试绿；实机断言（以 `node src/mcp-server.js` 即自家 petri-mcp 为回环被连对象，connect→listTools 非空→disconnect）证据落 acceptance/block-156/ |
| P3 工具投影与审批策略 | tool-defs/mcp.js 域 + registry 汇编 + HANDLERS/CONTRACTS + policy 接线（D4 档）+ tool-metadata 同轨 + 会话内工具调用链路 | agent-tool-registry 启动一致性绿；投影契约测试（命名空间/schema 转换/降级空集合）绿；agent-tool-policy 档位测试（R2 external-request 在四档下行为）绿；block109-p2 恒等绿；实机 agent 会话调用 MCP 工具全链断言证据落 acceptance/block-156/ |

完成语义：三阶段各自独立收口（定向门禁+实机证据+台账回写），整包 completed 需三阶段齐 + closeout 十一门绿；任一阶段发现跨包面即停下上报。

## 6. 依赖与环境纪律

- **零新增 npm 依赖**：`@modelcontextprotocol/sdk` 已在依赖（DEPENDENCY-CHANGE-CHECKLIST 结论：无新依赖）。
- dev 栈纪律沿 dev-infra skill：3000(vite)+3001(backend) 双启、后端改动须重启、实机验收含 UI 在场证据。
- 已知 WIP 零触碰：`acceptance/dev-verify/app-health-live.json`（2026-10-09 dev-verify 运行时再生成产物，非本包文件面）。
- 无 worktree（G0-RS-WT0 deferred 沿用），主工作区串行。

## 7. 范围外转候选池登记

- C-EXT-1：MCP HTTP/SSE 传输 + server 级信任配置（D3/D4 的 v2 演进）。
- C-EXT-2：marketplace 远程技能市场（清单基建参照插件 manifest-source 先例）。
- C-EXT-3：预路由 `mcp` 域收窄（D6 的 v2，需决策配置中心接线证据后评估）。


## 8. 收口笔录（2026-10-10）

### 8.1 三阶段总账

| 阶段 | 提交 | 定向测试 | 实机断言 | 证据 |
|---|---|---|---|---|
| P1 货架重组 | 1842c2ee | extensionShelves 5/5 + 扩展中心页 5/5 + LeftPanel 断言更新 + 邻域 62/18 + theme 4/4 + tsc 0 | CDP 八断言 ALL PASS（四货签在场/默认领域插件/嵌入无双重页头/D2 双向隔离/MCP 占位/旧深链 /plugins /skills 双重定向） | acceptance/block-156/block156-extensions-hub-live.json + p1-hub-domain-plugins.png |
| P2 客户端基座 | 7d4f9f97 | settings 5/5 + manager 4/4 + McpShelfPane 4/4 + tsc 0 | 回环九断言 ALL PASS（夹具确定性 1 工具 + 自家 petri-mcp 被连真实发现 28 工具 + UI 在场卡片 + 断开回落 + 清场复原） | acceptance/block-156/block156-mcp-client-live.json + p2-mcp-shelf-connected.png |
| P3 投影与策略 | 7599abc5 | 投影契约 6/6 + 回归 75 项 0 红（agent-tool-registry/block116/tool-activity-labels/block109-p2/policy/mcp-tool-registry/block113） | agent 全链十二断言 ALL PASS（真实 deepseek-flash 自主调 mcp_fixture_fixture_echo·echo 回流 assistant·transcript toolCalls 按名·流式帧在场·断开清面 409·清场） | acceptance/block-156/mcp-agent-loop-live.json |

UI 台账：UI-480（扩展中心四货架）verified + 加映 P2/P3（MCP 配置面与投影）。工具总数钉：静态 76 不动（投影为动态追加层，76 钉全数保持绿）。

### 8.2 设计落地偏差登记（对 §4/§5 的实现期细化，裁决意图不变）

1. **P2 通道形态**：plan §5 原写「channels mcp:* 通道族 + preload 包装」；实现改为**后端进程持有连接 + /api/mcp/servers\* HTTP 路由**（routes/mcp-client.js，前端 resolveApiBase 直连先例）。理由：MCP 连接必须与 agent 工具执行同进程（P3 callTool 进程内直达，跨进程无回路）；Electron main 侧 IPC 方案会让 P3 需要后端→main 反向调用通道。ipc-channels-registry 五闸因零新增通道天然绿。
2. **D4 落地面**：plan §4 D4 写「sideEffect=external-request + R2」；实现取 **execution + R2**。理由：policy 的 MUTATING_SIDE_EFFECTS 集合不含 external-request（既有 external-request 工具均为只读检索族 read_page/search 等），execution 语义才产生 D4 意图的档位行为（read/plan/workspace-write 禁、full 可用）——单测四档钉住。
3. **home 逃生通道**：plan §5 P1 列「home 入口收敛」；实现保持后端未就绪逃生通道直接嵌入 PluginStorePanel 浮层（即领域插件货架内容本体，无死链），不改路由——改路由反而劣化该场景 UX（栈未起时路由页无意义）。
4. **P3 投影为动态层而非 tool-defs/mcp.js 静态域**：plan §5 原写「tool-defs/mcp.js 域 + registry 汇编」；实现为 mcp-projection.js 动态投影（getProviderToolDefs 追加 + getToolEntry 兜底）。理由：MCP 工具随连接动态生灭，进静态域会破坏启动 fail-fast 三方一致性语义（defs/handlers 启动时必须齐备）；动态层零连接=零投影（R1），静态 76 恒等契约与全部总数钉不动。block109-p2 ⋃DOMAIN_TOOL_DEFS===TOOL_DEFS 保持绿（两者均为静态面）。

### 8.3 遗留与候选池

- C-EXT-1（HTTP/SSE 传输 + server 级信任）、C-EXT-2（远程技能市场）、C-EXT-3（预路由 mcp 域）维持 §7 原状。
- 新增观察：MCP 工具的 toolActivity 动词走「已调用 name」兜底（tool-events default 分支本就为动态工具预留）；若实际使用中 MCP 工具高频出现，再评估按 server 维度注册动词。
- ~~通用技能本地导入（D7 v1=本地目录导入）未在本包实现~~ → **2026-10-10 D7 补做交付**（完成校验器抓真：D7 推荐原文属「全按推荐」范围，自我缩圈转 C-EXT-4 不成立）：
  - 后端：`skill-registry.installSkillFromDir/uninstallImportedSkill`（validateSkillManifest 增 skillManifestVersion 契约检查 + 装后回读护栏防「装了却不可见」+ built-in id 冲突拒绝 + 重复导入覆盖）；
  - 通道：`skills:import-directory`（主进程对话框一条龙，复刻 pack installFromDialog 先例）+ `skills:import-path`（直路径，探针/测试与对话框共用安装函数）；channels/preload/electron.d.ts 三件套 + ipc-channels-registry 五闸绿；
  - 前端：通用技能货架导入按钮（成功即重发现/取消静默/失败 notice；领域货签无此钮）；
  - **缓存语义修正（存量行为面，D7 必要前置）**：loadInstalledSkills 跳过条件 `_registry.has` → `_sourceMap==='built-in'`（原条件把 installed 自身上次发现缓存误判为占用，导入更新后二次发现被跳过）；discoverSkills 尾部清 installed 残留（卸载后不返回旧条目）；SkillRegistry.discover 去一次性 `_initialized` 缓存（导入/卸载即可见）。skill 消费者回归 26 项（唯一红=block84 本机漂移存量）；
  - 验证：单测 4/4（合法装载/缺 manifest·坏 manifest·built-in 冲突 fail-closed/覆盖更新+卸载清净）+ 前端导入链路用例（含 store 模块缓存下 mock 竞态修正）+ **实机四断言 ALL PASS**（block156-skill-import flow：临时目录→renderer import-path IPC→通用技能货架卡片可见+按钮在场→宿主侧卸载零残留；对话框本体属 OS 层 UI 不在合成断言面）。C-EXT-4 销号。

G0 开发期常态 · 不外推 packaged/Provider/GA。
