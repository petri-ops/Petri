---
capability: gen-ui
goal: BLOCK-166 = Gen UI 沙箱可视化页面——模型在聊天回复输出 ::visualize 指令，客户端把模型事先写入会话专属目录的 HTML fragment 渲染为聊天流内嵌沙箱交互页（P0 可看 → P1 可交互 → P2 完整体验 → P3 加固）
acceptance:
  - P0：解析器单测（三种指令形态 / 代码围栏排除 / 未完成 pending 隐藏 / invalid 占位 / Windows 路径归一化去重 / schema 拒绝）+ 主进程 shell/CSP/路径包含校验/1MB 硬校验单测 + IPC 三步纪律钉 + 实机静态图表页渲染截图（acceptance/block-166/）
  - P1：断网渲染成功（vendor 本地映射，缺失明确失败不回退）+ fragment 内 fetch/XHR/WS 被禁 + openExternal 仅放行绝对 http(s) + 深浅色主题自适应
  - P2：重开会话 widgetState 恢复 + follow-up 进当前会话输入框（只读/过期拒绝）+ 放大预览/折叠不重载页面 + >1MB 拒绝报错
  - P3：注入渗透测试三路全过（消息正文/代码块/fragment 本体）+ vendor sha256 全量强校验 + 迁移任务书 §12 验收清单逐项对账
  - 每阶段：定向测试 + tsc 0 + lint 触碰面 0 error + docs:check / ui:audit:check；实机证据落 acceptance/block-166/
reopen: 阻塞 = 无（D1-D6 已按用户裁决落定，见 §3）
status: active
---

# BLOCK-166：Gen UI 沙箱可视化页面（::visualize → 聊天流内嵌沙箱交互页）

## §1 背景与用户裁决

- **源头**：[`docs/gen-ui-migration-prompt.md`](./gen-ui-migration-prompt.md)——对 ZCode 参考实现（`D:\1.WorkDir\reference\ZCode`，只读）分析产出的完整迁移任务书：规格（§1-§9）、分阶段计划（§10）、实测坑（§11）、验收清单（§12）、参考代码索引（§13）。本 plan 是其在本仓的正式承载，**规格细节以该任务书为准，本 plan 只记裁决与映射**。
- **用户裁决**（2026-10-10）：主代理评估后提请「①立项启动 ②D1-D4 选型裁决」，用户回复原话「**行 立项**」= 启动本包 + §3 选型按推荐概括授权（含命名 petri 化；如需回退 zcode 命名单点改回）。
- **能力定义**：模型用普通文件写工具把 HTML fragment 写进「会话专属可视化目录」→ 助手消息文本输出 `::visualize{"path":"...","title":...,"mode":...}` → 客户端解析、校验、读文件、包壳、在聊天流内渲染为独立 origin 沙箱 iframe（高度自适应、主题变量、`window.petri` 桥、widgetState 跨会话持久化）。

## §2 范围与非范围

**范围**（P0-P3 详目见 §5）：解析器与 schema；沙箱页面宿主（Electron 自定义协议独立 origin + CSP + vendor 离线映射）；guest 桥（`window.petri`）；widgetState 持久化；follow-up 追问；放大预览（锚点迁移）；复制图片；主题 CSS/工具类注入；模型侧契约（系统提示注入输出根 + `resources/skills/` 新增 visualize 技能）；独立导出脚本；注入渗透测试。

**非范围（exclusions）**：
- 旧版 Unicode 私有区标记形态（`U+E200/E202`）——任务书 §3.2 明示可选，新实现只支持 `::visualize{json}` 与 `::visualize{key=value}` 两种；
- MCP App 页面共池（ZCode 64 上限 LRU）——首期每卡片一页，租约接口预留（D5）；
- Tweak 面板——列为 P2 stretch，超出即登记候选不顺延；
- 无 workspace 绑定的会话使用 Gen UI——v1 诚实不可用（无输出根可写），见 §4-模型侧；
- `petri://` 文件摘要卡与 `::visualize` 卡的去重联动（ZCode `collectGenUiSourcePaths` 面）——Petri 无对应文件摘要卡面，无此需求；
- G1+ 项（packaged 公证、Provider、GA）——G0 开发期常态 · 不外推。

## §3 技术选型 D1-D6（已裁决）

| # | 决策 | 落定 | 依据 |
|---|---|---|---|
| D1 | 可视化输出目录 | **workspace 内** `<workspace>/.petri/gen-ui/<conversationId>/`，由后端按会话计算并注入系统提示 | Petri agent 文件工具全部经 `resolveWorkspaceTarget` 硬沙箱在 workspace 根内（`core/petri-server/agent-tools/workspace-tools.js`），放 userData 需扩放行面；workspace 内零后端工具改动；scopeKey=workspacePath+conversationId 天然成立 |
| D2 | 页面隔离 | **Electron 自定义协议独立 origin**：注册 privileged scheme `petri-genui://`，每页 origin `petri-genui://gen-<id>`，内存分区，shell 由主进程拼装并带 CSP 响应头 | 任务书 §6.1 Electron 路线；安全项不许推后（§14.3）；复用 `src/main/security-hardening.js` 加固底座 |
| D3 | guest 全局命名 | **petri 化**：`window.petri`、RPC 方法 `petri/gen-ui/*`、事件 `petri:set_globals`、初始状态 script id `petri-gen-ui-initial-state` | BLOCK-165 全仓改名先例（含协议层 `gewuevents→petrievents`）；参考实现照搬时同步改名，对照关系在实现注释留一行原 ZCode 名 |
| D4 | widgetState 存储 | **桌面侧 SQLite**：`src/migrations/` 新迁移建表 `(scope_key, file_path, state_json, updated_at)`，走 `src/database/` 既有 better-sqlite3 单例 | 符合项目「SQLite + 迁移」惯例；16KiB 级状态不适合塞消息 meta_json |
| D5 | 页面池 | P0-P1 **每卡片一页**；P2 引入放大预览时保留「页面实例与消息组件解耦」接口（bind/unbind 锚点迁移），池化与 LRU 驱逐**不做**（登记候选） | 任务书 §5 允许迁移初期每卡片一页 |
| D6 | 桥传输 | **简化版**：guest→parent `postMessage`（校验 `event.origin` 与 source iframe）→ 前端 relay → `desktopBridge` IPC → 主进程；不引 MessagePort/`@modelcontextprotocol/ext-apps` | 任务书 §8 明示「迁移可实现简化版，方法名保持一致便于对照」 |

实现中若确需新增 npm 依赖（含 zod 类校验库），先走 `$petri-project-governance` DEPENDENCY-CHANGE-CHECKLIST + 用户裁决；默认零新增（schema 用手写严格校验器，对齐 `CopilotMarkdown` 零依赖先例）。

## §4 架构映射（任务书六层 → 本仓文件面）

| 层 | 本仓承载 |
|---|---|
| [A] 解析器 | `frontend/src/components/copilot/gen-ui/references.ts`（移植 ZCode `references.ts` ~82 行 + 所需 directive helper：`findMarkdownCodeRanges` / 前缀与未闭合检测 / JSON 参数前缀正则）+ `schema.ts`（手写严格校验：绝对路径 Win/UNC/POSIX、禁 NUL/换行、文件名小写字母数字连字符、title ≤250、mode∈{"wide"}）。接线点：`SimpleChat/SimpleChatMessageRow.tsx` 对 assistant 消息先切分（`completed = !m.pending`）再分块走 `CopilotMarkdown`，`ui` 块渲染 `GenUiCard` |
| [B] 聊天卡片 | `frontend/src/components/copilot/gen-ui/GenUiCard.tsx`：工具栏（放大/复制图/关闭）+ 锚点 div + 高度容器（初始 240px、上限 10000px、±5px 绘制 gutter 补偿）+ invalid 占位 + 超限/缺文件可操作报错；对标既有 `ResultCard` 卡片形态 |
| [C] 沙箱宿主 | `src/main/gen-ui/`（`scheme.js` scheme 注册与 privileged 标志 / `paths.js` 输出根与路径包含校验 / `shell.js` 读文件+1MB 硬校验+包壳拼装 / `csp.js` / `vendor.js` 清单 sha256 校验）+ `src/main.js` 装配挂点 + `src/ipc/gen-ui.js` + `src/ipc/channels.js` 登记（`genUi.readFragment` / `genUi.getState` / `genUi.setState` / `genUi.openExternal`）+ `src/preload.js` 自包含字面量包装 + `frontend/src/lib/desktopBridge.ts` + `electron.d.ts` 类型真值源同步 |
| [D] guest 桥 | 壳内联 `gen-ui.js`（主进程注入字符串）：高度测量回报（`getBoundingClientRect`，防反馈回路：高度差≈视口差则忽略）+ `window.petri` 实现（widgetState 读写、`petri:set_globals`、`openExternal`、follow-up 透传） |
| [E] 状态服务 | `src/database/gen-ui-state-db.js` + `src/migrations/NNN_gen_ui_widget_state.sql`；scopeKey = `sha256(workspacePath + conversationId)` |
| [F] 高度/呈现 | 容器在 GenUiCard（B 层）；放大预览 P2（锚点迁移不重建 iframe） |
| 模型侧契约 | 后端系统提示组装点（`core/petri-server/agent-runner.js` / `loop-orchestrator.js`，实现时定位精确行）注入「可视化输出根」段：仅当会话绑定项目 workspace 时注入 `<workspace>/.petri/gen-ui/<conversationId>/` 绝对路径与 fragment 写作约束（任务书 §3.3）；未绑定 workspace 不注入（能力诚实缺席）。模型侧技能 `resources/skills/visualize/`（SKILL.md + manifest.json 登记，过 `npm run skills:check`）承载完整写作规范 |
| vendor 资源 | `resources/gen-ui/vendor/`（d3@7.9.0 / lucide@1.17.0 / floating-ui 1.7.3+1.7.4 固定版本 + `manifest.json` url→file→sha256，拷贝自参考仓 visualize-plugin assets，随附第三方许可文件）；shell 拼装时把三个固定 CDN URL 重写为 `petri-genui://gen-<id>/vendor/...`，缺失/哈希不符明确失败不回退网络（坑 1） |
| 主题 | 主进程拼壳注入基础 CSS：标准变量名（`--background/--foreground/.../--viz-series-1..6`，任务书 §7）值取自 `--petri-*` token 映射；深浅色跟随 `html[data-theme]` 经 `petri:set_globals` 主题事件热更新；fragment 只准用变量与工具类 |

**安全边界（P0 即生效）**：CSP `default-src 'none'` + 内联脚本样式 + script-src 白名单 CDN 域（任务书 §6.1）+ frame-src/form-action/connect（仅 blob:/data:）全禁；guest 固定 sandbox 语义（无 allow-same-origin 于宿主 origin，独立 origin 天然隔离）；主进程读文件做 **路径包含校验**（realpath 解析后必须落在该会话 scope 根内，纵深防御——模型输出 path 不可信）；`openExternal` 仅绝对 http(s) + 可见实例校验；页面禁导航/弹窗/下载（`setWindowOpenHandler` deny-all 底座已在）。

## §5 分阶段计划与阶段验收门禁

### P0 可看（静态渲染即可用）
1. 前端：解析器 + schema + 单测；`GenUiCard` 基础版；`SimpleChatMessageRow` 接线（不动 markdown 组件本体）。
2. 主进程：scheme 注册 + 协议 handler（读文件/包含校验/1MB/包壳/CSP/vendor 重写壳）+ IPC 三步（channels → preload → desktopBridge/electron.d.ts）+ 最小高度回报脚本。
3. 后端：系统提示输出根注入；模型侧 `resources/skills/visualize`。
4. **门禁**：解析器单测 ≥15 用例（三种形态/围栏排除/pending 半截整体隐藏/invalid/路径归一化去重/schema 各拒绝分支）+ shell/CSP/包含/1MB 单测 + IPC 双向守卫测试自动覆盖 + `test/impact-map.json` 登记新文件分类 + tsc 0 + lint 触碰面 0 error + `skills:check` + docs/ui 门禁；**实机**：dev 栈真模型输出静态图表页渲染截图，证据 `acceptance/block-166/`。

### P1 可交互
1. `window.petri` 完整桥（widgetState 内存版 + `petri:set_globals` + `openExternal` 白名单校验 + 主题事件）。
2. 主题 CSS/工具类（任务书 §7 清单移植 + `--petri-*` 值映射）+ `data-tooltip`。
3. vendor 三库离线映射（manifest + sha256 逐文件校验）。
4. **门禁**：桥单测（方法分发/参数校验/16KiB 上限/禁 load 自动保存）+ vendor 映射与缺失失败测试 + CSP 禁断言（fetch/XHR/WS 注入样本被拦）+ openExternal 拒绝分支测试；**实机**：断网渲染 D3 交互页证据。

### P2 完整体验
1. widgetState 持久化（D4 迁移 + scope key）+ 重开恢复（初始状态快照）。
2. follow-up 追问（接 `SimpleChat` 现有输入绑定；只读/过期/非当前会话明确拒绝）。
3. 放大预览（锚点迁移不重载）+ 复制图片（sender/沙箱 ID/几何校验后原生剪贴板）。
4. 独立导出脚本 `scripts/`（vendor 嵌 data URL，任务书 §6.4）。
5. **门禁**：持久化往返与恢复测试 + follow-up 绑定拒绝分支测试 + 预览迁移不重载测试 + 导出产物离线可开测试；**实机**：交互页（D3+滑块）重开会话状态恢复证据。

### P3 加固
1. 注入渗透测试：恶意 `::visualize` 三路（消息正文 / 代码块内 / fragment 本体：脚本逃逸、fetch 外联、`<iframe>` 子框架、表单提交、`window.open`）。
2. vendor sha256 全量强校验 + CSP/origin 审计笔录。
3. **门禁**：渗透清单全过 + 任务书 §12 验收清单逐项对账 + closeout 十一门。

**节奏**：分 P 阶段跨会话推进，每阶段独立提交并附该阶段门禁证据；P3 全清单过 → 整包 completed。

## §6 关键坑对策（任务书 §11 十一条全数承接 + 本仓特有）

1. vendor 清单 sha256 精确校验，不同步即明确报错不白屏不回退（P1 起）。
2. 只渲染已完成消息：`completed = !m.pending`；流式期间未闭合前缀与半截 JSON 参数（前缀正则见参考实现）后正文整体隐藏防闪烁。
3. 代码围栏内 `::visualize` 是普通文本：解析前先算围栏字符偏移区间。
4. fragment 换行转义串整页失效：visualize skill 强制「字面书写 + 写回读检查」。
5. 高度反馈回路过滤：高度差 ≈ 视口差则忽略该次上报。
6. `setWidgetState` 禁 load 自动保存；宿主持久化 ack 后才 resolve。
7. 状态变化绝不自动开启新模型轮次（follow-up 是唯一显式入口）。
8. 路径去重前 Windows 分隔符归一化。
9. 脚本加载顺序固定：initial-state → bridge → CSS → vendor → 作者脚本；D3 7.9.0 按需。
10. follow-up 只走当前会话输入绑定，只读/过期拒绝。
11. 1MB 硬校验，超限可操作报错。
12. **本仓**：renderer 侧 IPC 全走 `desktopBridge`，类型真值 `electron.d.ts`（quality:arch 会拦直引）。
13. **本仓**：新 IPC 必入 `channels.js` 注册表，`preload.js` 自包含字面量，双向漂移测试自动守护。
14. **本仓**：`SimpleChatMessageRow.tsx` 增行会触 code-size 台账 → 阶段收口重锚留痕；新生产文件必须登记 `test/impact-map.json`（fail-closed）。
15. **本仓**：guest CSS 为注入字符串不走 `theme-token-contract`；但 `--petri-*` 值读取须从 token 单源取，禁止在 shell 拼装处硬编码色值。

## §7 依赖、环境纪律与并行隔离

- **零新增 npm 依赖**（D6 简化传输 + 手写校验器 + vendor 为随包静态资源）。
- **环境纪律**：主进程 scheme 注册需重启 Electron；后端系统提示注入需重启后端；实机验收走 dev 栈（`:3000` vite + `:3001` 后端 + CDP）。
- **并行隔离**：BLOCK-165-PETRI-OSS-RENAME 仍 active（P7 推送已提交、收口条目待其会话回写）——本包代码面为**全新文件**（`frontend/src/components/copilot/gen-ui/`、`src/main/gen-ui/`、`src/ipc/gen-ui.js`、`src/database/gen-ui-state-db.js`、`resources/skills/visualize/`、`resources/gen-ui/`），共享面仅台账四件（AUDIT-LOG / roadmap / DOC-REGISTRY / README）追加式登记；不触 BLOCK-165 的 plan、codemod、证据文件。BLOCK-161（planned 排队）零触碰。BLOCK-165 收口时 `rg -i "gewu|biof3"` 复扫与本包新增面无交叠（本包全用 petri 词汇）。
- **参考件权属**：任务书与参考仓为用户提供的迁移输入，移植权属由用户掌握；vendor 第三方库（d3/lucide/floating-ui）随附其原许可文件。
- **Jev 如实记录**：立项时 `test:suggest` 与 `doc:suggest` 均因 cloud 供给不可用降级（`.petri-dev-user-data/jev.env.bak-by-user-request` 缺失），非零建议。

## §8 完成语义与证据位置

- **完成语义**：P3 收口时任务书 §12 八项验收逐项对账全过 + closeout 十一门 + `docs:reconcile`/`docs:check` → plan `completed`；中途阶段只声明 `P#-COMPLETED` 不越权宣称整包完成。
- **证据**：`acceptance/block-166/`（每阶段实机截图/断言 JSON/渗透测试记录）；解析器与宿主测试随实现落在 `frontend/src/components/copilot/gen-ui/*.test.ts` 与 `test/gen-ui-*.test.mjs`。
- **台账**：阶段收口按 `AUDIT-LOG-ENTRY-TEMPLATE.md` 回写；唯一 active 状态由 roadmap 顶行承载。
