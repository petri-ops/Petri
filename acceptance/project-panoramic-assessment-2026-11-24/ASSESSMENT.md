# Petri Desktop 全景评估（2026-11-24 · 外部视角专项）

> 触发：用户「全方位梳理一下项目内容，从你的视角评估细节，看看有哪些需要优化扩展的不？」，随后「全景评估结论 保存下来」。
> 性质：专项结论型——只评估；除本报告与 AUDIT-LOG 指针行外零文件改动，不翻任何台账状态，不启动工作包。
> 基线：HEAD `4c5f6128`（评估期间另一会话向 main 推入 `d4405084`、`4c5f6128`）；串行槽位空。
> 方法：主代理做仓库级度量与文档治理对账；4 个只读分域评审（core 内核 / Electron 主进程 / 前端 / 工程基建）；主代理对全部 P1 与重点 P2 逐条读证据行核证。标「已核实」的行级结论均为静态核证；除 §3 列明的门禁外未跑测试与构建，缺陷均未实机复现。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。本文不含 G1+ 建议，不重开既有用户裁决。

## 0. 结论

底盘扎实；当前最该投入的不是加功能，而是修一批已核证缺陷，并让门禁重新可信。

- 已核证缺陷：5 条 P1 + 7 条 P2（§2）。
- 门禁可信度：提交不自洽、尺寸门在 HEAD 为红、棘轮被例行上调、CI 覆盖极窄、全量无绿灯记录（§3）。
- 治理与入口：必读集过重、状态入口指向过期规划、AGENTS.md 规模数字全面过期、多会话共用同一工作树（§4）。
- 扩展面：行为评测集、通用 agent 技能包、真续跑、前端性能（§5）。

## 1. 规模读数

| 项 | 读数 |
|---|---|
| 产品代码 | core 155,128 行（非测试）· 前端 104,483 行（非测试 TS/TSX）· 主进程约 16,700 行 ≈ 27.6 万行 |
| 基建与测试 | scripts 128,464 行 · test 144,019 行 · 前端测试 55,165 行 ≈ 32.7 万行 |
| 测试文件 | Node `test/*.test.mjs` 843 · 前端 `*.test.ts(x)` 406 |
| 文档 | `docs/` 顶层 638 个 md（block 计划 418）· registry 665 条 · `ui-productization-audit.md` 1.85MB · `DOC-REGISTRY.json` 872KB |
| 证据 | `acceptance/` 跟踪 3,170 个文件，磁盘 306MB |
| 节奏 | 评估开始时 main 4,314 个提交；近 30 天 945 个，其中 548 个（58%）不含产品代码改动 |
| Git | 27 个 `worktree/p_*` 本地分支全部已合并且无 worktree 在用 |

## 2. 应优先修的缺陷（主代理已核证）

| # | 级别 | 缺陷 | 证据 | 说明与修法 | 确定性 |
|---|---|---|---|---|---|
| 1 | P1 | 网络瞬断重试后正文重复下发 | `core/petri-server/loop-orchestrator.js:843-848` | `streamedText` / `srEmittedTextLength` 只在 attempt 开头清零；`callProviderWithNetworkRetry` 的重试发生在同一 attempt 内，且首个 srAttempt 的重放过滤器为 null，重试后新一轮 `content_delta` 追加到已下发的半截文本之后。`test/block109-stream-retry.test.mjs` 只断言 result，不断言下发事件。修法：重发前清零并下发重置事件，或带已出文本续写；补 events 断言。 | 代码核实，未实机复现 |
| 2 | P1 | 缓存清理 fail-open | `core/petri-server/cache-manager.js:357-366, 445` | `runningTaskIds` 声明后从未填充；查库失败只记 errors 后继续，`dbTaskIds` 为空时全部缓存被判 orphan 删除。该模块零测试引用。修法：查库失败即中止本轮清理；守卫接入真实运行任务；补单测。 | 代码核实 |
| 3 | P1 | 本机请求边界三处缺口 | `core/petri-server/bootstrap.js:47-60`、`core/shared-backend/local-request-boundary.js:62-86`、`core/petri-server/mcp/client-manager.js:130-134`、`routes/mcp-client.js:202, 235` | 全局门对无 Origin 与非 http(s) Origin（含 `null`）放行，交由路由级 token 门裁决；但 `requireTrustedDesktopOrigin` 只挂在 `files.js`（13 处）与 `ssh-projects.js`（5 处），204 条变更路由里 186 条对 `Origin: null` 无校验，含 MCP 注册与连接。MCP stdio 子进程以 `env: { ...process.env }` 继承全量环境，`childProcessEnv` 只剥一个已停用的旧令牌。修法：`Origin: null` 收口、MCP 路由纳入 token 门、子进程 env 白名单透传。MCP 命令白名单默认值维持 2026-11-16 既有裁决，不在本项范围。 | 各环节核实，利用链未尝试 |
| 4 | P1 | Cmd+Q 守卫拦不住后续拆除 | `src/main/desktop-shell.js:350-354`、`src/main.js:894-902`、`src/ipc/terminal.js:364-368`、`src/ipc/window-manager.js:638-650` | 守卫 `preventDefault` 后，后注册的 `before-quit` 监听仍执行：后端被 shutdown（`shuttingDown` 置位后 `start()` 拒绝重启），终端会话被杀。用户点「取消」后应用存活但没有后端。现有实机 flow 只测预览腿。修法：清理移到 `will-quit`，或先判 `defaultPrevented`。 | 代码核实，未实机复现 |
| 5 | P1 | 排队消息挂载即被清空 | `frontend/src/components/copilot/SimpleChat.tsx:242-261, 800-804` | 懒初始化从 localStorage 水合（注释写「刷新不丢」），挂载 effect 无守卫地 `setQueuedPrompts([])`，回写 effect 再把空数组落盘。修法：仿 `project-workspace.tsx:469-475` 加「仅会话变化时清空」守卫，补重挂载测试。 | 代码核实，未实机复现 |
| 6 | P2 | 工作区文件读取 IPC 无包含校验 | `src/ipc/working-tree-review.js:148-169` | `path.resolve(workTree, args.path)` 无 realpath 包含校验，`..` 或绝对路径可读工作区外任意不超过 1MB 的文件；`workTree` 缺省时回落 `process.cwd()`。`src/ipc/file-dialog.js:374-400` 的 `resolveWorkspaceFile` 已有正确写法可复用。另：`file:open-path` 白名单含脚本扩展名，且无扩展名文件放行（`file-dialog.js:27-42, 201-202`）。 | 代码核实 |
| 7 | P2 | 命令风险闸可见性漏洞 | `core/petri-server/agent-tools/agent-tool-policy.js:46-55`、`agent-tools/workspace-tools/internals.js:52-57, 71-80` | 动态维度只看首 token；风险清单正则以 `^` 与 `[;&|]` 锚定且无 `m` 标志，换行分隔、`$()` 内嵌、`find -delete` 形式的 `sudo` / `rm` 连 `riskWarnings` 都不出。命中清单默认放行是既有裁决，本项只指「可见」这一半的缺口。 | 代码核实 |
| 8 | P2 | `web_fetch` 校验与建连分离 | `core/petri-server/helpers/web-fetch-policy.js:303-317` | `resolveHostAddresses` 的结果不用于建连，`fetch` 按主机名重新解析，存在 DNS 重绑定间隙。修法：用校验过的 IP 建连。 | 代码核实 |
| 9 | P2 | Express 4 下 async 路由抛错即悬挂 | `core/petri-server/routes/model3d.js:75-85`、`routes/mcp-client.js:235` | 主 app 无错误中间件；await 后的异常使请求既无 5xx 也无超时，前端无限等待。修法：统一 asyncHandler 加全局 500 JSON 中间件。 | 两处抽查核实；「共 59 个」为代理计数 |
| 10 | P2 | `skills:execute` IPC require 路径错（潜伏） | `src/main.js:413, 469`、`test/ipc-relative-requires.test.mjs:14, 26` | `require("../_mapSkillRuntimeStatus")` 解析到仓库根（文件在 `src/`），handler 恒返回 module not found；前端目前无调用方。漂移门只扫 `src/ipc/*.js`，`src/main.js` 与 `src/main/` 是盲区。 | `require.resolve` 复现 |
| 11 | P2 | CSP 端口写死，后端回退端口分支失效 | `src/main/csp-config.js:19-20`、`src/main/_backend-ports.js:33-44`、`src/main.js:799` | CSP 仅放行 3000/3001；3001 被非本应用进程占用时后端改用其它端口，此时 `connect-src` 拦掉全部 API。另 `NODE_ENV=development` 可让打包态走 dev CSP（`src/main/core-utils.js:31-34`）。 | 代码核实，未实机复现 |
| 12 | P2 | three 与 `@xyflow` 经静态链进入首屏 | `frontend/src/App.tsx:39` → `pages/welcome.tsx:11` → `SimpleChat.tsx:65, 75` → `ChatArtifactCard.tsx:2` → `Model3DScene.tsx:2-7`；`ToolActivityDock.tsx:5` → `OrchestrationGraph.tsx:10`；`vite.config.ts:225-230` | `manualChunks` 只拆 `vendor-react`，路由级懒加载被 `/` 首屏抵消。修法：改走现成的 `Model3DSurface` 懒包装，dock 内 `lazy`。 | 静态核实，未重新构建 |

## 3. 门禁与工程可信度

- **提交不自洽**：`test/impact-map.json:9870` 引用未入库的 `test/c56-user-manuscript-fidelity.test.mjs`（`d4405084` 写入）；`scripts/test-affected.mjs:104` 对缺失测试直接抛错。本机 list 模式 exit 0，只因文件在盘上；干净检出下 `test:changed` 必红，而 CI 不跑它。
- **`gate:code-size` 在 HEAD 为红**（实跑，7 行违规）：`SimpleChat.tsx` 1952 > 1944、`simple-chat.css` 5494 > 5469、`src/main.js` 925 > 920；增长来自 11-23 的 QODER-A2 / L5 提交，台账最后一次重写停在 11-21。
- **棘轮被例行上调**：`acceptance/block-92/size-baseline.json` 近 30 天被 68 个提交改写，其中 23 个提交标题明写重打/重锚。knip 基线 244 → 406 为代理读数。
- **测试入口漏网**：`test:all` 只匹配顶层 `test/*.test.mjs|cjs`；`test/pipeline.test.js`、`test/block67-node-agent-fs.test.js` 与 `test/scripts/` 下两个测试永不执行。
- **写死个人绝对路径**：`p6-pack-table-surface-disable`、`p6-artifact-switch-pack`、`p6-result-surfaces-retire`、`p6-inspect-decider` 四个测试读兄弟仓 `pack.json` 且无存在性守卫，换机必红。
- **全量无绿灯记录**：最近一次停在 11-09（node-core 5,178 项、3 红）。`scripts/test-all-shards.mjs:5, 55` 注释自述默认并行 `node --test` 在此规模三次确定性挂起，而 `test:changed` 的 fail-closed 升级目标正是默认并行的 `test:all`。
- **CI 覆盖极窄**：`.github/workflows/ci.yml` 只跑约 19/843 个 Node 测试与 2/406 个前端测试，加前端 tsc 与 `build:spa`；closeout 门禁都不在 CI。近 8 次运行 7 绿 1 红。
- **`impact-map.json`**：496KB、455 条规则（296 条以 block 编号），note 合计 82,254 字符；33 条具体路径 pattern 指向不存在的文件；近 30 天 273/945（29%）的提交改过它，是多会话并发的头号冲突点。
- **脚本面**：`scripts/` 587 个跟踪文件中 257 个带 block 编号、229 个文件名含 live。代理判定未归档孤儿 116 个。
- **证据卫生**：`acceptance/block-169/ui495-h1-before-commit.png` 与 `…-after-commit.png` sha256 相同，与 2026-07-26「重启前后截图逐字节相同」同型。代理计重复 blob 263 份 / 24.5MB。
- **零散缺口**：
  - `.gitignore:10` 的 `build/` 盖住了已入库的 `build/` 源码目录，新增 hook 会被静默忽略。
  - `.claude/skills/` 有 6 个桥、`.codebuddy/skills/` 有 7 个，缺 `petri-ui-design`。
  - `test/user-asset-guard-baseline.json` 的 9 项未含根目录未跟踪的 `petri-informal-paper.md`。
- **现读门禁**：`docs:check` PASS（665）、`ui:audit:check` PASS、`hygiene:check` PASS、`gate:code-size` FAIL、`test:changed:list` exit 0。

## 4. 治理与入口

- **必读集过重**：AGENTS.md 29KB + AUDIT-LOG 66KB + roadmap 42KB + handoff 48KB，约 186KB。其中 handoff 58 条（38.6KB）与 roadmap 64 条（41.5KB）是过期的「最后更新」链，按既有规则应分别只留 1 条 / 8 条；自稳脚本只覆盖 AUDIT-LOG。
- **状态入口指向过期规划**：`remaining-work-plan-2026-11-23` 在 registry 登记为 `reference`，`npm run state` 的「常驻计划」层看不到它，仍列出已闭环的 `NEXT-WORK-BLUEPRINT-2026-11-16`；roadmap 末尾指针同样指向该蓝图，并写着「串行 active = BLOCK-454」。
- **`active` 语义被稀释**：registry 56 条 `active` 里 34 条是 `reference` 类，含 11 条 BLOCK-10 架构 survey/mapping、三代 `DOC-INDEX`、三份 `NEXT-PHASE-E2E-PROMPT`。
- **待处理表堆积**：评估开始时 AUDIT-LOG「当前待处理项」72 行中 33 行写着「已完成 → 见最近处理记录」。并发会话随后做过一次 compact。
- **AGENTS.md 规模数字全面过期**：测试 317 → 843；src 的 js 72 → 101；组件 `.tsx` 162 → 230；`main.js` 686 → 925；`SimpleChat.tsx` 1664 → 1952；`ReviewMode.tsx` 1310 → 1429；`project-workspace.tsx` 1170 → 1233。
- **对外入口停更**：根 `README.md` 与 `CHANGELOG.md` 停在 2026-10-10。README 仍以全组学领头，与 2026-11-02 钉死的「通用 agent 为主线」人设不一致；Quick Start 仍写 `npm run dev` 自动拉起后端，与 BLOCK-457 之后的启动方式不符；版本口径为 `package.json 0.0.4` 对 `v0.0.1-rc.7`。
- **并发写入是共同根因**：评估期间另一会话向 main 推入 2 个提交；日志中「登记滞后」已自记至第 6 例。

## 5. 值得扩展的方向

1. **行为评测集**：`evals/` 只有 13 个场景（3 real + 9 smoke + 1 golden）；母纲 Q-MATRIX 的 95/102 只证明能力在场，不证明做得好。建议补四条基线：任务成功率、工具调用效率、单任务 token 成本、上下文韧性；先用 mock provider 做确定性回归，真实 Provider 腿沿 C-26/C-27 的既有裁决走。
2. **通用 agent 技能包**：产品内置 `resources/skills/coding-playbook` 只有 1.1KB、六条守则；仓库自己的六维代码评审、验证闭环、委派任务书都没进产品。可按 BLOCK-124「内化重写」做成通用技能（系统化调试、验证闭环、代码评审、测试设计、重构）。
3. **真续跑**：`loop-orchestrator.js:860-899` 的 stall-resume 重发的是同一请求体，不带已出文本；`core/shared-backend/loop-stall-resume.js:66-76` 按已发字符数剥离前缀。而下发的状态文案是「从已生成内容后自动续跑」，与实现不符。
4. **前端性能**：three / `@xyflow` 进首屏（§2 第 12 项）；全仓 `React.memo` 仅 4 处；代理计 29 处 `setInterval` 仅 3 处判断 `document.hidden`。

立项自检（产品个性纪律）：四项都在通用能力主线上；差别形态落在证据自证（行为基线）、可信透明（续跑文案与实现一致）与本地可审计，不涉及 G1+。

## 6. 做得好的

- **前端类型纪律**：`any` 与 ts-ignore 均为 0；状态库规范零违例；四层 Error Boundary。
- **测试卫生**：`.only` 与 `.todo` 均为 0；ESLint 抑制基线现读 192 条。
- **主进程**：全局 IPC 信任门 fail-closed 且拒 webview sender；四个窗口的安全基线有机械测试。
- **后端**：先绑端口再加载模块；stall 看门狗只认有效 token；工作区路径多重防护；`task_events` 唯一约束，启动重排失败即阻断启动。
- **脚本引用完整**：263 条脚本引用的 339 个路径全部存在（代理核）。

## 7. 建议顺序

均未开工，需用户发令；须避开并发会话在制面。

1. **TRUST-FIX-TRIO**（Jev 0.45，小体量修复包）：§2 第 1、2、5 项。
2. **SEC-LOCAL-BOUNDARY**：§2 第 3 项（`Origin: null` 收口、MCP 路由纳入 token 门、子进程 env 白名单）。
3. **GATE-INTEGRITY**：提交自洽检查（已跟踪文件不得引用未跟踪路径）、require 漂移门扩到 src 全域、test glob 递归、去掉个人绝对路径、棘轮上调须留因。
4. **ENTRY-REALIGN**（纯文档）：AGENTS.md 去硬编码计数、roadmap / state 指针、README 对齐人设、过期链自稳。

第一包的可复制启动提示词：

```
你是 Petri Desktop 全自动执行 Agent。用户发令「开始 TRUST-FIX-TRIO」。先读 docs/AUDIT-LOG.md 头部，按下列自包含范围推进，不另找提示词文档：
① core/petri-server/loop-orchestrator.js：网络瞬断重试（callProviderWithNetworkRetry）重发前清零 streamedText / srEmittedTextLength 并下发重置事件，或带已出文本续写；HK-01 = test/block109-stream-retry.test.mjs 增加下发事件拼接后不重复的断言。
② core/petri-server/cache-manager.js：查库失败即中止本轮清理，运行中守卫接入真实运行任务，补单测（当前零引用）。
③ frontend/src/components/copilot/SimpleChat.tsx：排队队列 effect 加「仅会话变化时清空」守卫并补重挂载测试；优先抽成 usePromptQueue hook，同时消掉 gate:code-size 对该文件的红。
纪律：单工作包串行、HK-01 红绿先行、每步定向测试 + closeout 门禁 + 证据落 acceptance/ + 六件套回写 + commit/push；收口前确认已跟踪文件不引用未跟踪路径。
红线：观感项有用户偏好裁决的走预审闭环、无偏好裁决的保持 in_progress 不代签；新裁决点 / 产品级新依赖 / G1+ 停下报用户；不触碰并发会话在制面；未获用户发令不启动后续阶段。
```

## 8. 落档过程中的新增发现

- **W5a 门在 HEAD 为红（存量，与本报告无关）**：`test/nso-w5-impact-coverage.test.mjs` 报 3 个已入库测试未挂 impact-map 规则：`test/p6-driver-iframe-probe.test.mjs`（11-21 入库）、`test/p6-pack-scheme-privileges.test.mjs`（11-22）、`test/utility-host-decision.test.mjs`（11-23，QODER-L5）。「新增测试必须挂规则」三天内被绕过三次，是 §3 的直接例证。
- **证据落档的隐性成本**：向 `acceptance/` 新增任何文件都必须在 `test/impact-map.json` 登记，否则 `test:changed` 直接 FAIL_CLOSED（exit 2）。本报告登记在兜底规则 `closed-batch-evidence-dirs` 下。
- **P6 源绑定对脏树敏感**：`test/impact-map.json` 是 P6 的绑定源，任何未提交改动都会让 `test/g0-rs-p6-product-acceptance.test.mjs` 报 `p6_current_source_tree_not_exact`，提交后即消失。
- **AUDIT-LOG 两张表不成表**：「当前待处理项」与「最近处理记录」的表头下都没有分隔行，现存唯一一条分隔行错位在表体中段，Markdown 渲染时不成表格。
- **定向测试现读**：`npm run test:changed` 235 项中 233 过、2 红，即上述 W5a（存量）与 P6 源绑定（由本报告登记的未提交改动触发）。

## 9. 一次性执行提示词（2026-11-24 用户「一次性搞定，要没问题的搞定」）

§7 的四步顺序合并为一个工作包、六个串行阶段；每阶段出口全绿并提交后才进下一阶段。本节为可复制启动提示词的留档，与对话中给出的版本一致。

```text
你是 Petri Desktop 全自动执行 Agent。用户发令「开始 PANORAMIC-REMEDIATION-2026-11-24」= 全景评估一次性修复包（用户原话：「一次性搞定，要没问题的搞定」）。本提示词即预授权：下列范围内的改动连续推进，不必逐项再问；没写的范围一律不做。

【先读】
1. docs/AUDIT-LOG.md 头部，含 🟡「全景评估待处置项」行。
2. acceptance/project-panoramic-assessment-2026-11-24/ASSESSMENT.md 的 §2（12 条已核证缺陷，含证据行号与修法）、§3、§4、§8。
3. AGENTS.md；立项与收口用 $petri-project-governance，会话启动、实机验证、卫生检查用 $petri-dev-infra。
4. npm run state 与 git status：串行槽位若已有 active 工作包，或工作树里有他人未提交的跟踪改动，先停下报用户，不要并行开工。

【总纪律】
- 一个工作包，S1 到 S6 严格串行；上一阶段出口判据全绿并提交后才进下一阶段。
- 每个修复点先写会红的测试（HK-01 红绿先行），改动最小（HK-02），零新依赖。
- 「没问题」高于「做完」：任一项 3 轮内达不到出口判据，就停在当前阶段边界，保持已提交部分全绿，写清卡点报用户；不带病提交、不放宽门禁、不改判据凑绿。
- 行数棘轮只减不增。core/petri-server/loop-orchestrator.js（基线 1674 行）已顶格，src/main.js（920）与 frontend/src/components/copilot/SimpleChat.tsx（1944）已超格：新增逻辑一律落到新子模块，主文件只做薄接线并净减行。
- 共享台账（docs/AUDIT-LOG.md、docs/DOC-REGISTRY.json、docs/README.md、test/impact-map.json）每次写入前重新读取最新内容，只做追加式修改。
- 提交一律显式路径，禁止 git add -A 与 git add .。push 前先 git fetch；origin/main 前进时，仅当工作树没有他人未提交的跟踪改动才可 git rebase origin/main，否则停下报用户；禁止 stash、checkout、reset 他人改动。
- 决策工具按 AGENTS.md 到点即跑（test:suggest、doc:suggest、next:suggest、output:judge），结果如实附在交付说明里。
- 既有裁决不重开：风险命令命中清单仍是「默认放行 + 可见」；MCP 命令白名单仍只在显式设置环境变量时生效；不碰 G1+（Provider 矩阵、公证签名、GA、远程发布）。
- 本包是修复包，不应出现可见的界面观感变化；一旦出现，停下报告。

【S0 立项与基线】
按 $petri-project-governance 建工作包（plan、registry、README、AUDIT-LOG 同批，编号按 registry 顺延），证据目录 acceptance/panoramic-remediation-2026-11-24/。逐门记录当前红绿（closeout 全部门与 test:changed）作为收口对照，存量红如实登记归属。

【S1 正确性修复】对应报告 §2 第 1、2、4、5、10 项
1.1 流重试正文重复（core/petri-server/loop-orchestrator.js:843-848 的 callProviderWithNetworkRetry）
现状：网络瞬断重试在同一 attempt 内整轮重发，streamedText 与 srEmittedTextLength 不清零，重放过滤器为空，重发内容追加到已下发文本之后。
改法：重试前若已有下发内容（文本或工具调用增量），装载与 BLOCK-508 同款的重放过滤器（core/shared-backend/loop-stall-resume.js 的 createResumeEventFilter）；没有任何下发时保持现状。不新增事件类型，不动前端。
HK-01：扩展 test/block109-stream-retry.test.mjs 与循环层测试：首连下发半截后断开、重连完整重发时，下发的 content_delta 拼接后恰好等于完整正文一次。
1.2 缓存清理 fail-open（core/petri-server/cache-manager.js:357-366、445；调度入口在同文件 startScheduler）
改法：查库失败即中止本轮清理，临时目录与缓存都不删，report 标 aborted；runningTaskIds 用 analyses.status 的未终态任务填充（终态集合以代码里的状态词表为准）。
HK-01：临时目录加临时 SQLite 三例——查库抛错零删除；运行中任务的缓存保留；孤儿且闲置的缓存删除。该模块当前零测试。
1.3 Cmd+Q 退出守卫（src/main/desktop-shell.js:350-354；src/main.js:894-902；src/ipc/terminal.js:364-368；src/ipc/window-manager.js:638-650）
改法：除退出守卫外，其余 3 个 before-quit 监听一律先判 event.defaultPrevented，已拦截就直接返回；app.once 改为 app.on，保证真正退出时清理仍会执行。不要把清理挪到 will-quit：src/main.js:906 的 SQLite 收敛依赖现有顺序。
HK-01：按注册顺序模拟监听——守卫拦截时后端 shutdown 与终端清理不触发，放行时触发。实机：扩展 dev-verify 的 block223-desktop-shell-live 流程，覆盖「退出摘要、取消、后端健康检查仍为 200 且终端会话仍在」与「确认退出、后端停止」。
1.4 排队消息挂载被清空（frontend/src/components/copilot/SimpleChat.tsx:242-261、800-804）
改法：把队列状态、水合、回写、清空抽成 usePromptQueue hook；清空只在 conversationId 或 projectId 真正变化时执行（参照 project-workspace.tsx:469-475），挂载时不清空。
HK-01：renderHook 测试——预置 localStorage 后挂载，队列保留；切换会话后清空。
1.5 require 路径与漂移门（src/main.js:413、469；test/ipc-relative-requires.test.mjs:14、26）
改法：../_mapSkillRuntimeStatus 改为 ./_mapSkillRuntimeStatus，两处合并为模块级一次加载；漂移门扫描范围从 src/ipc/*.js 扩到 src 下全部 .js（preload.js 的自包含规则不变）；src/main.js 回到 920 行以内。
HK-01：扩范围后的门禁在修复前对 src/main.js 报红，修复后转绿。
出口：以上测试全绿；test:changed 除已登记的存量红外无新增红；独立提交。

【S2 门禁自洽】对应报告 §3、§8
2.1 清 W5a 存量红：把 test/p6-pack-scheme-privileges.test.mjs、test/utility-host-decision.test.mjs、test/p6-driver-iframe-probe.test.mjs 挂到对应规则的 tests。
2.2 测试入口补全：test:all 与 scripts/test-all-shards.mjs 的文件枚举改为递归覆盖 test/ 下的 *.test.mjs、*.test.cjs、*.test.js。新纳入的 4 个测试（test/pipeline.test.js、test/block67-node-agent-fs.test.js、test/scripts/ 下两个）逐个处理：仍有效的修好并挂规则，已无对应生产代码的删除并在 plan 留因，不得用 skip 掩盖。
2.3 去个人绝对路径：p6-pack-table-surface-disable、p6-artifact-switch-pack、p6-result-surfaces-retire、p6-inspect-decider 四个测试改用环境变量 PETRI_PACK_BIO_ROOT（缺省为仓库同级目录 petri-pack-bio），路径不存在时显式 skip 并写明原因。
2.4 提交自洽门禁：新增 gate:tracked-consistency——已跟踪文件引用的仓库内路径必须存在且已跟踪，至少覆盖 test/impact-map.json 的 tests 与具体路径 pattern、package.json 脚本的文件目标；在制未入库项走带 owner 与日期的豁免基线。挂进 closeout 与 CI。HK-01：夹具引用一个未跟踪文件即红。同时清理 impact-map.json 里 33 条指向不存在文件的具体路径 pattern，逐条确认无测试依赖。
2.5 棘轮上调留因：scripts/code-size-ledger.mjs 的 --write 默认只允许下调，上调必须带 --allow-grow <path>=<reason> 并写入条目；knip 棘轮同形。然后清掉当前 gate:code-size 红：SimpleChat.tsx 靠 1.4 的抽取回到 1944 行以内，src/main.js 靠 1.5；simple-chat.css 的 25 行增量属 QODER-A2 骨架样式，核实来源提交后用 --allow-grow 写明。
2.6 CI：在 .github/workflows/ci.yml 的 push 触发里加静态门禁步骤（docs:check、ui:audit:check、quality:secret、quality:arch、quality:lint、quality:types、gate:code-size、gate:css-modules、gate:arch-cycles、quality:knip:check、gate:tracked-consistency），补 timeout-minutes 与 concurrency。只在 CI 环境出现的红逐个定位修复；修不了的把该门移出 CI 并登记原因，不得留着红门。release.yml 不动。
出口：W5a 绿；gate:code-size 绿；gate:tracked-consistency 绿；推送后用 gh 确认 CI 至少一次全绿；独立提交。

【S3 本机边界与加固】对应报告 §2 第 3、6、7、8、9 项；以下收紧已由本提示词授权
3.1 本机请求边界
a. core/petri-server/bootstrap.js:47-60：Origin 为 null 或其它非 http(s) 来源的变更请求（POST、PUT、PATCH、DELETE）必须携带正确的 x-petri-local-request-token，未配置 token 时直接 403。无 Origin 的本地调用、可信桌面 Origin、GET 请求三条语义不变；其它 http(s) 来源维持现状。复用既有 reason code local_request_token_required，不扩词表。
b. core/petri-server/routes/mcp-client.js 的 10 条变更路由（79、106、154、175、189、202、225、237、247、270 行）挂 requireTrustedDesktopOrigin。
c. 子进程环境：在 core/shared-backend 新增一份共用的剥离函数，按变量名剥除 PETRI_LOCAL_REQUEST_TOKEN 与名字含 TOKEN、SECRET、PASSWORD、PASSWD、API_KEY、PRIVATE_KEY、CREDENTIAL、ACCESS_KEY、SESSION_KEY 的变量，其余环境原样透传。不做白名单，避免打断用户 MCP 服务器的环境依赖。接入 core/petri-server/mcp/client-manager.js:133 与 workspace-tools/internals.js 的 childProcessEnv；服务器自身配置的 env 合并后同样过一遍剥离；连接日志只写被剥除的变量名。
先读 test/block67-routes.test.mjs 与 test/m5a-production-wiring.test.mjs：BLOCK-67 拖出下载语义（Origin: null + 正确 token 放行）必须保持。若既有测试断言了「Origin: null 的变更请求可无 token 通过全局门」，该断言就是要修的缺口，改测试并在 plan 写明；不得为保测试放宽新门。若发现真实产品流程依赖无 token 的 Origin: null 变更请求，停下报用户。
HK-01：边界五例（无 token 403、正确 token 放行、GET 不受影响、无 Origin 不变、可信 Origin 不变）；MCP 路由无 token 403；环境剥离三例。
3.2 工作区文件读取（src/ipc/working-tree-review.js:148-169）：解析后做 realpath 最近祖先包含校验，绝对路径、..、指向工作区外的符号链接一律拒绝；顺手扫 src/ipc 下其它读文件 IPC，同型缺口一并修。file:open-path（src/ipc/file-dialog.js:27-42、201-202）：无扩展名且带可执行位的文件，以及 shell 脚本与 Windows 可执行关联类扩展名（.sh .bash .zsh .fish .ksh .ps1 .psm1 .bat .cmd .command .scpt .workflow .vbs .vbe .wsf .ws .msi .msp .exe .com .scr .pif .cpl .hta .jar .run .app .dll .so .dylib），不再用系统默认程序打开。
3.3 命令风险可见性（workspace-tools/internals.js:52-57；helpers/command-risk-rules.js；agent-tools/agent-tool-policy.js:46-55）：风险正则加 m 标志，锚点扩到换行与命令替换，补 find … -delete 与 xargs … rm 两类；动态维度改为逐个命令段取首 token 判断（按换行、;、&&、||、| 分段，剥掉 sudo 与前置环境变量赋值）。命中后的处置不变。
3.4 Express 错误处理（core/petri-server/routes/，如 model3d.js:75-85、mcp-client.js:235）：加统一 asyncHandler 与全局错误中间件，async 抛错返回 JSON 5xx；错误形状沿用项目既有错误契约，只包装当前没有 try/catch 的 handler。
3.5 web_fetch 重绑定（core/petri-server/helpers/web-fetch-policy.js:303-317）：连接钉在校验过的地址上（node:http、node:https 的 lookup 选项），逐跳重校验的现有逻辑保持。既有测试：test/block247-web-policy.test.mjs、test/qoder-l1l2-wiring.test.mjs。做不到零新依赖又不破坏这些测试，就保持现状并登记为遗留，不得削弱现有防护。
出口：test/block405-l1-security.test.mjs、test/g0-chf0-http.test.mjs、test/env-coordinator-trusted-origins.test.mjs、test/block239-mcp-oauth.test.mjs、test/block258-mcp-tail.test.mjs 与上述新测试全绿；quality:secret 绿；独立提交。

【S4 端口与首屏】对应报告 §2 第 11、12 项
4.1 CSP 端口（src/main/csp-config.js:19-20、src/main.js:799、src/main/_backend-ports.js:33-44）：CSP 按实际后端端口与渲染进程 Origin 生成；开发态 CSP 只在未打包且 isDevMode 时使用，打包态恒用生产 CSP。
4.2 首屏（frontend/src/components/copilot/ChatArtifactCard.tsx:2、ToolActivityDock.tsx:5）：3D 场景改走现成的 Model3DSurface 懒包装（Model3DSurface.tsx:46），OrchestrationGraph 在 dock 内 lazy，补 Suspense 兜底。
HK-01：CSP 单测（后端在非 3001 端口时 connect-src 含该端口且不含 3001；打包态加 NODE_ENV=development 仍是生产 CSP）；首屏静态扫描（从 App.tsx 的静态 import 链到不了 three 与 @xyflow/react）；前端 tsc 零红、theme-token 契约绿。
出口：dev Electron 实机腿——主流程可用、控制台零 CSP 违规、SSE 与聊天流正常、3D 产物卡可展开；构建产物里 three 位于独立 chunk。拿不到实机证据的项不提交，如实登记。

【S5 入口归位】纯文档，对应报告 §4；只改事实性数字与指针，不改任何纪律条文
5.1 AGENTS.md：删去会漂移的规模数字（文件数、行数、测试数、门数），改为现读命令；逐条核实 frontend/AGENTS.md 引用的路径，不存在的修正。
5.2 docs/next-steps-roadmap.md：末尾指针改指 docs/remaining-work-plan-2026-11-23.md，删去「串行 active = BLOCK-454」这类过期表述；registry 里 REMAINING-WORK-PLAN-2026-11-23 的 kind 由 reference 改为 living-plan，让 npm run state 能列出；NEXT-WORK-BLUEPRINT-2026-11-16 的状态只在证据确认已闭环时才改。
5.3 过期更新链：handoff 与 roadmap 各自只留最近 1 条，历史原文搬移到 docs/archive/checkpoints/（搬移不改写），并把 roadmap 纳入现有自稳脚本的幂等管辖。
5.4 根 README.md：定位段对齐 AGENTS.md 已钉死的「人设一句话」；Quick Start 对齐 BLOCK-457 之后的启动方式；版本表述改为「G0 开发期，版本以 package.json 为准」。CHANGELOG.md 顶部补一条 Unreleased，指向 docs/README.md 与 DOC-REGISTRY.json。
5.5 docs/AUDIT-LOG.md 两张表补上表头分隔行、移除错位的那条（纯格式，零文字改动），确认 state 与 compact 解析不受影响。
出口：docs:check、ui:audit:check、hygiene:check 绿；独立提交。

【S6 总验证与收口】
- npm run closeout:full 全绿；确属环境性或存量的红逐条归属登记，不算本包失败，但不得把 SKIPPED 写成 PASS。
- npm run test:all:sharded --all 跑完并留存原始输出，环境性红逐条归属。
- dev Electron 实机腿汇总：发消息与流式输出、排队追问刷新后保留、Cmd+Q 取消与确认、文件打开、MCP 连接、审批卡。9223 离屏实例跑完即 kill。
- 写 acceptance/panoramic-remediation-2026-11-24/REMEDIATION.md：逐项对照报告 §2 与 §3，列改了什么、提交号、测试、实机证据、状态。
- 回写：AUDIT-LOG 的「全景评估待处置项」行按实际结果更新（已修、遗留及原因）；六件套同步；最后按 NEXT-STEP-BRIEF 给下一步提示。

【立即停下报用户】需要新裁决；需要产品级新依赖；要改本提示词没授权的安全边界；涉及删除用户数据或不可逆操作；发现并发会话的在制改动与本包冲突；同一项 3 轮仍不过。

收尾输出：改了什么、验证过什么、还欠什么（如实，含遗留项）；附技能透明标签与 Jev 计数。
```

## 附录 A：分域代理上报、主代理未逐条复核的发现

保留原始证据指针以便后续取证；未复核不等于已确认。

**A1 core 内核**

- 每帧多次同步 SQLite、事件 seq 双写者：`loop-orchestrator.js:925, 933`；`agent-runner.js:354-364`；`agent-task-store.js:724-737` 与 `routes/ai-agent/team.js:70, 90`；`llm-providers/io-transcript.js:22, 257`。
- tasks 查询无界、DB 路径解析双轨：`agent-task-store.js:392-419, 498-502, 745, 1006-1017, 1222, 246`；`db/connection.js:22`。
- 五个约 1500 行级的巨型闭包：`loop-orchestrator.js:182-1672`、`agent-runner.js:281-1144`、`helpers/tools-executor.js:107-2049`、`agent-tools/workspace-tools.js:95-1586`、`shared-backend/result-studio-repository.js:93-1792`。
- 失效守卫与死代码：`helpers/permissions.js:148`、`auth.js:8-12`、`bootstrap.js:97-106`（moduleGate 恒放行）；`routes/index.js:14-30`；`agent-task-store.js:20-244, 1116-1205`（任务级重试子系统零调用）；core 的 1,957 个 catch 中 618 个静默。
- 调度与清理类接线零单测：`server-main.js:323-324, 345, 407-408`；46 个模块无测试引用。
- 脱敏与审计 fail-open：`io-transcript.js:18-19, 247-250`；`mcp/ide-tools/audit-log.js:56, 75-77`；`shared-backend/error-log.js:14-15, 40, 45`。
- core 反向依赖壳层：`server.js:19`、`server-main.js:57`、`config.js:12`、`mcp/oauth-provider.js:22`。
- 其它：`db/connection.js:25` 外键关闭；`core/petri-server/ARCHITECTURE.md:49, 57, 67` 与现状不符；四套事件通道、两条 SQLite 连接、两个同名 plugin-loader。

**A2 Electron 主进程**

- 迁移双轨、首败即止：`src/migration-runner.js:96-113`；裸 `ALTER TABLE` 在 `012` / `018` / `019` / `020` / `022`；自愈补列不记账：`core/shared-backend/result-annotation-schema.js:180`、`result-studio-schema.js:232`。
- 运行时与插件落盘脆弱：`src/plugin/io.js:17-53`（下载无超时）；`src/plugin-manager.js:202-203`（先删旧再解压）；`src/plugin/installed.js:87-89, 105` 与 `core/shared-backend/pack-registry.js:32-34, 52`（非原子写）；三份下载实现。
- 全局 `window.open` 兜底绕过外开准入：`src/main/security-hardening.js:262-271`；轨道窗无导航门 `src/ipc/window-manager.js:235-286`；打包态回落加载 dev 地址 `src/main/_window-create.js:242-247`。
- 主进程同步 IO 与句柄泄漏：`src/ipc/data-management.js:34-53, 71`；`src/main/backend-proc-manager.js:106-113, 191`；`src/static-server.js:76, 109-116`。
- preload 全量面不分窗口（25 个命名空间、145 个 invoke；主窗守卫只覆盖 67/162）：`src/preload.js:87-602`；无守卫 handler 见 `src/ipc/pack.js:88-93`、`utility-host.js:65`、`ssh-host.js:112`、`terminal.js:207`、`ai-settings.js:46-57`。
- 主进程调后端 REST 无超时、无鉴权头：`src/ipc/working-tree-review/context.js:40-41`；`projectId` 缺省回落应用自身仓库 `:71-110`。
- 其它：`electron-builder.yml` 无 `protocols` 段；`src/` 内无 `render-process-gone` 处理。

**A3 前端**

- 页面组件订阅整份运行快照：`conversationRunStore.ts:439-447`、`conversationRunStore/runListeners.ts:9-11`；`project-workspace.tsx:151`、`:958-1063`；`lib/copilotContextProvider.tsx:117`。
- 消息行 key 含窗口下标：`SimpleChat.tsx:1426`、`SimpleChat/hooks/useConversationResume.ts:140-151`。
- 轮询缺隐藏暂停：`ToolActivityDock.tsx:29, 103-124`（常驻 1s）；`hooks/useWorkspaceLayout.ts:229-234`；`pages/window/CommandCenterJobsWall.tsx:268`。
- 三个巨型组件各是一个函数：`SimpleChat.tsx:225-1952`（22 个 useState、19 个 useEffect）；`ReviewMode.tsx:57-1429`；`project-workspace.tsx:70-1222`。
- HTTP 数据访问层碎片化：`.tsx` 内 `fetch(` 128 处、手工拼 `Authorization` 104 处；`SimpleChat/attachmentInline.ts:55` 忽略 `rApiBase`。
- 反馈通道不一致：`useToast` 仅 1 处使用；48 个发请求的 tsx 仅 6 个同时有 loading 与 error 态（启发式）。
- 可访问性：`workspace-panels/LeftPanel.tsx:524, 707, 794` 的会话项是只可点的 `<li>`；221 个表单控件中 47 个无 label 关联；14 个 modal 层中 7 个无 `role="dialog"`。
- 样式残留：`z-index` 字面量 CSS 94 处加 TSX 10 处，4 处高于 Toast 层；内联裸色 40 处 / 11 个文件。
- 配置与依赖漂移：`vite.config.ts:206`、`tsconfig.json:22` 指向不存在的 `src/lib/useBaseUrl-mock.ts`；`remark-admonitions`、`@codemirror/lint` 零引用；`frontend/AGENTS.md` 指向 7 个不存在的路径。

**A4 工程基建**

- `scripts/` 复制粘贴家族：55 对脚本行集 Jaccard ≥ 0.5；`*live*` 脚本 228 个 / 50,154 行；最大的 10 个脚本里有 7 个是 `g0-rs-p6-*`。
- `package.json` 脚本面：90 条直调编号一次性脚本，35 条 `:update` 变体；`check` 单条 4.7KB。
- `impact-map.json`：89 个测试未挂规则；`block-N` 规则 294 条。
- knip 基线 244 → 406，其中 files 类 35 → 206，四天内被上调 15 次；根因在 `knip.json:14-22, 54-62` 只登记了 14 个 dev-verify flow。
- `eslint-suppressions.json` 192 条全部没有 reason 字段。
- `ci.yml` 未设 `timeout-minutes` 与 `concurrency`；164 个 `snapshot-*` tag；`electron-builder.yml` 残留已移除 R runtime 的注释与资源。
- 依赖归类：`@electron/notarize` 在 dependencies 但只有 `build/afterSign.js` 使用；typescript 两套版本范围并存。

## 附录 B：方法与限制

- 只读：未修改产品代码、文档或台账状态；未运行测试套件、构建与 closeout 全链。
- 实跑的门禁与工具：`docs:check`、`ui:audit:check`、`hygiene:check`、`gate:code-size`、`test:changed:list`、`npm run state`、`gh run list`（只读）；`next:suggest`（TRUST-FIX-TRIO，confidence 0.45）、`doc:suggest`、`output:judge`（fit 3.7 → PASS）。
- 缺陷结论均为静态核证，未实机复现；安全相关只读代码，未做任何利用尝试。
- 未覆盖：`helpers/tools-executor.js:1357-1752`（R / Python 执行与 SSH 直跑）、result-studio 与 g0-* 科学链路、`mobile-gateway/tunnel.js`、`mcp/ide-tools` 路径细节、前端 15 处 exhaustive-deps 豁免与 218 处 `vi.mock`。
- 测试形状分类为启发式：Node 测试里约 39% 装载生产模块、49% 兼有读源码文本、40% 带契约/扫描器字样；前端测试渲染型约 51%、纯逻辑约 46%、源码扫描约 3.7%（代理计数）。
