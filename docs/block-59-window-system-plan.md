# BLOCK-59 — 窗口系统：停靠 / 弹出 / 指挥中心 / 边缘活动轨道

> 状态：`completed`（2026-09-05 用户裁决启动 → 同日 P0–P4 一次会话整包收口：P0 窗口管理器 36/36 + P1 结果窗 26 断言 + P2 轨道/终端窗 14 断言 + P3 指挥中心 10 断言 + P4 agent 详情窗 10 断言，四套实机脚本收口前顺序回归全 PASS；UI-292/293/294/295 verified）
> 立项日期：2026-09-04（用户裁决「创建吧」）；启动日期：2026-09-05（用户裁决，候选序裁决为 59 先于 48）；收口日期：2026-09-05
> truthDomain: `block-59-window-system`
> 来源：用户想法（子 agent 工作流 / 分析结果的独立展示窗口）→ 综合主流参考（VS Code auxiliary windows + codex agent command center）+ 原创配件（边缘活动轨道）；经四轮讨论收敛（三层架构权重裁决 70/20/10）

## 1. 背景与方向裁决

**用户原始想法**：无论编程通用智能体、工作智能体还是生信专家智能体，都会用到子智能体与结果呈现——这些活动界面能否各自成为独立窗口，实时展示工作流程与分析结果（本地或远程）？担忧：会不会变复杂、占资源？

**方向裁决（四轮讨论收敛）**：

1. **可行且合理，时机正确**——codex 2026-09-04 同步的 51 个新提交中 5 个在建 agent command center（session resume / live task details / shared composer），方向互相印证。
2. **不做「每个智能体强制一个窗口」**——3+ 并行 agent 时浮窗注意力成本超过收益。改为「**默认停靠 + 按需弹出**」（VS Code 模式）。
3. **原创做配件不做中心**——轨道是弹出窗的「第三态宿舍」，不是系统中心（讨论中曾跑偏为轨道中心主义，用户纠正后收敛）。
4. **一个窗口子系统，三种形态，全部可逆**——不是三个功能。

## 2. 三层架构（权重明确）

| 层 | 模式来源 | 权重 | 职责 |
|---|---|---|---|
| **L1 停靠 ↔ 弹出**（日常路径） | VS Code auxiliary windows | ~70% | 主窗 Tab/面板为默认态；任何面板可拖出/弹出成独立窗，可收回。**用户日常只碰这一层** |
| **L2 指挥中心墙**（多任务俯瞰） | codex agent command center | ~20% | 独立单例总览窗，网格瓦片聚合所有 agent/作业实时状态；点击瓦片下钻到 L1 弹出窗。多任务时才打开 |
| **L3 边缘活动轨道**（BioF3 特色配件） | 原创 | ~10% | 只做一件事：**降格窗口的存放处**——弹出窗点 × 不销毁，缩进屏幕右缘，hover 可恢复 |

**用户动线一句话**：单任务主窗 Tab，想盯就**弹出**（VS Code）；多任务开**指挥中心**俯瞰下钻（codex）；暂时不看想留着：× **降格进轨道**，hover 恢复（BioF3）。

**架构检验标准**：任一层砍掉系统都成立——原创不绑架架构。

## 3. 窗口状态机（核心契约）

```
docked ──弹出──► popped ──×/超上限──► railed ──显式移除──► closed
  ▲                 │                      │
  └────收回（状态零丢失）◄───┐              └──hover 恢复──► popped（回记忆位置）
```

- **三活态一终态**：docked（主窗 Tab）/ popped（独立窗，≤4 并发）/ railed（隐藏保活）/ closed
- **× 永远是降格不是销毁**——本契约核心，写死在 plan；销毁只有一条路：轨道卡显式「移除」
- **静态项 5min 淡出**（railed 中已完成结果窗），常驻项（终端/agent 窗）不淡出
- **超上限自动降格**：第 5 个弹出窗出现时最老的自动降入轨道
- **指挥中心与轨道容器为单例**，不进状态机（前者随开随关无状态，后者常驻）

## 4. 窗口管理器（主进程新模块，全系统唯一真相）

### 4.1 内容类型注册表

| 类型 | 路由 | × 行为 | 恢复语义 | 单例 |
|---|---|---|---|---|
| `result`（结果聚焦窗） | `/window/result/:artifactId` | → 轨道（静态，5min 淡出） | 路由重载 | 否 |
| `terminal`（终端窗） | `/window/terminal/:sessionId` | → 轨道（常驻） | 会话存活即恢复 | 否 |
| `agent`（agent 详情窗，P4） | `/window/agent/:runId` | → 轨道（常驻） | 任务状态恢复 | 否 |
| `command-center` | `/window/command-center` | 直接关闭 | 无状态 | 是 |
| `rail`（轨道容器） | 内部专用 | 不提供 × | — | 是 |

### 4.2 关键裁决

1. **P1 弹出窗一律只读**——结果窗可看可缩放可比对，但**编辑/改参留在主窗**。切掉「双窗同开一个 artifact 的写冲突」，MVP 面积减半；写能力随 Result Studio 编辑链成熟后再评估
2. **弹出窗不置顶**——只有轨道容器 `alwaysOnTop`（巡视面）；普通弹出窗是正常窗口（工作面）
3. **同一内容禁止双开**——`result:artifactId` 已弹出时再点「弹出」= 聚焦既有窗
4. **位置记忆归主进程**——geometry（`{x,y,w,h,displayId}`）由 main 持有并持久化；副屏失效回落主屏默认位 + 安全偏移
5. **路由白名单在 main 校验**——窗口创建只接受注册表声明的路由模式，fail-closed 不加载任意路由

### 4.3 IPC 面（additive，全走 desktopBridge）

`window:pop-out` / `window:return` / `window:minimize`（→轨道）/ `window:restore` / `window:remove`（轨道显式移除）/ `window:state-changed`（注册表增量多播给所有存活窗）。

复用既有资产：`src/main/_window-create.js`（窗口创建集中处，BLOCK-9.1 成果）加窗口类型参数；同一 SPA 走 react-router 路由（**不建第二套前端**）；task_events/SSE 数据链复用。

## 5. 边缘活动轨道（配件规格，克制版）

- **只读窗口注册表**——轨道不订阅 tool_jobs/loop_runs 全量事件流，不建第二套任务状态面（治理红线）；只显示「哪些窗口被降格了」
- **规格与消息轨道同构**（产品签名）：常态透明度 0.45，hover 0.72 + 宽度 14→28px 展开；刻度 hover 浮出 320px 卡（锚轨道左侧，垂直钳位复用 UI-255 重钳思路）；滚轮换卡；单屏刻度上限 7，超出收拢 `+N`
- **轨道窗本体**：极窄 BrowserWindow（`focusable:false` 非激活面板不抢键盘焦点 / `skipTaskbar` / `alwaysOnTop` / 不随全屏空间显示）；生命周期属 app 不属主窗
- **视觉语言**：与消息轨道同语法（会话内轨道管理消息，屏幕级轨道管理窗口），用户零学习成本

## 6. 备选方案裁决（均留拒绝理由）

| 备选 | 结论 | 理由 |
|---|---|---|
| 纯主窗多面板（不做独立窗） | ❌ | 用户原始需求就是独立窗；跨 app 置顶巡视、多屏分屏做不到 |
| 每项目一个主窗（workspace-per-window） | ❌ 留未来 | 与单项目工作区模型冲突，改动面巨大；登记远期候选 |
| WebContentsView 做弹出窗 | ❌ | 不能成为顶层窗口，语义不对 |
| 多入口轻量 bundle（窗口用独立构建） | ⏸ 备用优化 | 冷启动更快更省内存，但代码分叉 + 构建复杂；MVP 用同一 SPA 走路由，实测内存超标再切换（路由层不变，切换成本可控） |
| macOS 原生窗口合并 Tab | ✅ 免费彩蛋 | Electron 白送（Window → Merge All Windows），零成本支持，写文档不写架构 |
| 主窗内分屏对比（VS Code editor groups） | ⏸ 未来 | 真实生信需求（结果 A/B 并排），弹出窗双开已覆盖大半场景，先观察 |

## 7. 分期

| 阶段 | 内容 | 依赖 | 验收门 |
|---|---|---|---|
| **P0** | 窗口管理器模块（注册表/状态机/IPC/geometry 持久化）+ 单测 | 无 | 状态机全转移路径单测；路由白名单 fail-closed 测试 |
| **P1** | 结果窗弹出/收回/只读聚焦视图（复用 Result Studio 组件） | P0 | 实机：弹出→收回状态零丢失；同内容双开=聚焦；重启后窗不恢复（诚实范围） |
| **P2** | 轨道容器窗 + 统一 × 语义 + 终端窗弹出（衔接已收口的 BLOCK-54：弹出=把某 Tab 会话升格为窗） | P0 | 实机：× 降格→hover 恢复；静态 5min 淡出；≤4 上限自动降最老 |
| **P3** | 指挥中心（瓦片读 tool_jobs/task_events 既有真相） | P0 | 实机：瓦片实时进度；点击下钻弹结果窗；**零第二真相**（只读投影） |
| **P4** | agent 详情窗（实时工作流，衔接已收口的 BLOCK-49 spawn 链路） | P0 | 实机：子 agent 实时工作流展示；终态摘要对齐 |

**排队建议**：P0–P3 无硬依赖，不抢占当前 active（BLOCK-57 远程执行）槽位，待其收口后由用户裁决启动；与 54（已收口，终端 Tab 升格窗）/57（远程作业进指挥中心瓦片）有协同但互不阻塞。

## 8. 资源账（诚实版）

- 每个独立 BrowserWindow ≈ 一个渲染进程 ~100–200MB；5 窗 = 0.5–1GB，对同时跑 R 分析的 16GB 机器不可忽略
- 四层缓解：**懒创建**（用户第一次弹出才创建）/ **隐藏保活**（hide 后停止 GPU 合成，内存降约 1/3，事件流继续记账）/ **≤4 并发上限**（对齐 BLOCK-54 终端 4 Tab 哲学）/ 轨道窗本体仅 ~40–60MB
- 反向收益：主窗渲染进程不再被多个实时流重绘拖累——多窗口把渲染负载分摊出去
- 轨道只要收起过一个 PiP 窗就回本；实测超标则启用多入口 bundle 备用方案

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| 每窗 100–200MB | 懒创建 + ≤4 上限 + hide 降载；超标启用多入口 bundle（§6 备用） |
| 窗口销毁时订阅泄漏 | 管理器统一销毁钩子：`closed` 事件必经注册表清订阅（单测覆盖） |
| 双窗数据不一致 | P1 只读裁决 + 全部窗口读后端真相（SQLite/SSE 多播），窗口永不持有 canonical state |
| 轨道 `focusable:false` 平台差异 | mac arm64 先行实测；Windows 行为差异记 P2 风险项 |
| 主窗关闭（macOS app 不退） | 弹出窗/轨道生命周期属 app；全部关闭才走既有退出收割（对齐 BLOCK-54 全量 kill 语义） |
| × 语义被未来改动稀释 | 「× = 降格」写入本 plan 为不可变契约；后续任何工作包改动 × 行为须先修订本 plan |

## 10. 治理边界

- **不建第二套真相**：轨道只读窗口注册表；指挥中心瓦片只读 tool_jobs/task_events 既有真相；窗口永不持有 canonical state——对齐「不得创建第二套 executor/job/artifact/workflow/UI truth」治理红线
- 0 新 npm 依赖（全部复用 Electron BrowserWindow / 既有 SPA / SSE 链）
- 不动 BLOCK-49/54/57 的实施边界；协同关系（终端升格/远程瓦片/agent 窗）只在各自落地时按 additive 接口对接
- G0 开发期常态 · 不外推 packaged/Provider/GA

## 11. 进度记录

- 2026-09-04 P0（planned 登记）：用户裁决立项。四轮讨论收敛：①用户提出独立窗口想法→评估可行性与资源；②四态形态（停靠/墙/PiP/收起）与参考系；③轨道深挖后被用户纠正「不要跑太远」→收敛为三层架构权重 70/20/10（原创做配件不做中心）；④细化补完（状态机/注册表/IPC/备选裁决/分期）→用户裁决「创建吧」。本计划落盘并注册 DOC-REGISTRY；P0–P3 无硬依赖；P4 衔接已收口的 BLOCK-49。
- 2026-09-05 P0 启动（planned → active）：用户裁决「按照你的建议 先59」（候选序 59 先于 48）。前置核验：BLOCK-57/60 均已收口、AUDIT-LOG 无阻塞项、无 worktree、工作区无未知 WIP（openclaw/ 非本包范围不触碰）。当前唯一 active 工作包 = BLOCK-59。P0 范围：窗口管理器模块（内容类型注册表/窗口状态机/IPC 面 additive/geometry 主进程持有并持久化）+ 状态机全转移路径单测 + 路由白名单 fail-closed 测试。
- 2026-09-05 P0–P4 整包收口（一次会话，e3b32e33 → acd863c1）：
  - **P0 窗口管理器**（e3b32e33）：`src/main/_window-manager.js` 纯核心（无 Electron 依赖参数注入）+ `src/ipc/window-manager.js` 适配器 7 通道 IPC + state-changed 多播 + close 拦截降格 + before-quit 收割 + sender 作用域；`_window-create.js` additive `onSpaServerReady`；preload `windowManager` 桥段 + electron.d.ts；单测 36/36（全转移路径/白名单 fail-closed/geometry round-trip+副屏回落/事件增量/适配器 preload main.js 静态契约锁）；impact-map 补 block59 规则。**plan 具体化偏差（如实登记）**：内容键落地为 `result:<jobId>:<artifactName>`（渲染需 job 上下文，/api/tools/status 语言无关自举）；KEY_PATTERN 放行非 ASCII 产物名（路由经 encodeURIComponent 保安全，'.'/'..' 显式拒绝）。
  - **P1 结果窗**（40cde076，UI-292 verified）：WindowShell（frameless 拖拽 chrome + 收回/×）+ WindowResultPage 只读聚焦视图（manifest 归一 + Result Studio 纯函数按类型渲染）+ App.tsx /window/* 路由分支（不挂主窗 Provider 树）+ ResultView「弹出」入口；实机 26 断言（弹出/同内容聚焦/收回/× 降格保活/恢复/**popped 态 remove 被拒契约实证**/轨道移除销毁/geometry 持久化/真实按钮点击）。
  - **P2 轨道 + 终端窗**（ccbe8e2f，UI-293 verified）：28px 透明 alwaysOnTop 轨道条带窗（懒创建/穿透 ignoreMouseEvents/rail-mouse hover 切换/无条目自动 hide）+ RailPage 只读注册表投影（刻度点击恢复/hover 320px 卡显式移除/static 5min 淡出视觉降权/7 刻度收拢 +N）+ terminal.js `forwardToContentWindow`（terminal:data/exit 送达受管窗）+ TerminalWindowPage（同一 pty 第二活视图，主窗 tab 保活零丢失）+ BottomTerminal 升格按钮；**实机抓真修**：rail sender 被自身作用域规则拦截——轨道授予全量变异权（hover 恢复/显式移除是轨道职责，plan §5）；实机 14 断言（pty 升格/xterm 挂载/数据面转发实锤/降格→轨道懒创建/刻度点击恢复/自动隐藏/显式移除终结）。
  - **P3 指挥中心**（b2397ed2，UI-294 verified）：CommandCenterPage 单例无状态窗（**零第二真相**：瓦片只读 /api/tools/history 既有 REST，5s 轮询最近 12 作业；诚实耗时进度不虚构百分比；点击瓦片下钻 L1 结果窗）+ WindowShell `closeBehavior` prop（'rail' 契约默认 / 'close' 无状态单例真关闭）+ TitleBar 入口；实机 10 断言（单例创建/不双开/瓦片与 tool_jobs 真相交叉核对/下钻弹出/× 随开随关不进轨道）。
  - **P4 agent 详情窗**（acd863c1，UI-295 verified）：AgentWindowPage 复用 `subscribeAgentTask` 既有 SSE（/api/ai/agent/task 零新后端面，断线退避续传同款）——全量回放即实时路径，时间线 tool_call/result 200 条环形截断 + 终态摘要 delta 回放累积（与父会话/wait_agent 同源）+ 终态徽章如实；toolActivity additive `agentRunId`（仅 spawn/wait/list 提取）+ ToolActivityList「详情窗」按钮；**实机抓真修**：statusChip 类名跨 CSS module 引用错位（tsc 不可见）；实机 10 断言（真实历史子 agent 8 tool_call + 92 delta 回放渲染/摘要 1258 字符/徽章「已完成」/流健康）。
  - **加映（2026-09-05 用户反馈「弹窗主题与主界面不一致」，UI-296 verified）**：窗口 CSS 模块引用了 8 个编造令牌（--biof3-bg-primary 系），硬编码暗色兜底使弹窗永远暗色与主题脱钩；全部改用 custom.css 语义令牌（bg-canvas/surface/subtle、status-success 族）明暗自适配；顺手修 5 处先于本包存在的存量令牌违规（RemoteTargets/simple-chat/LeftPanel/project-workspace），theme-token-contract 契约测试回绿并纳入回归面（本次定向测试选择曾漏跑该契约——教训记录）；实机 9 断言（light 白画布 / 主窗切暗弹窗经 storage 事件实时跟随 / 指挥中心瓦片随主题 / 原偏好恢复），证据 `acceptance/block-59/theme-live.json`。
  - **加映二（2026-09-06 用户反馈「hover 应可预览 / 轨道展示不全看不出是啥」，UI-297 verified）**：根因一=轨道窗 28px 宽，320px hover 卡整体被窗体裁剪（预览物理不可见）→ 轨道窗加宽 28→364（预览区 336 透明穿透 + 条带 28）；根因二=刻度是纯色块 → 刻度带类型图标（bar-chart/terminal/brain）。新增降格瞬间内容快照（capturePage 可见态采集，×/minimize 全部先快照后 hide）+ window:thumbnail IPC；hover 卡 = 快照图 + 标题 + 恢复/移除 + 180ms 防误关延迟。单测 37/37（加映二契约锁）；实机 9 断言（卡右缘 328<364 物理在窗内/快照 naturalWidth=480/图标刻度/恢复路径完好）+ P2 原 14 断言回归 PASS；证据 `acceptance/block-59/rail-preview-live.json`。
  - **收口门**：四套实机脚本（block59-ui-live/p2/p3/p4-live）收口前顺序回归全 PASS（60 断言）；单测 36/36；前端受影响 vitest 23/23；tsc 0；docs:check + ui:audit:check PASS；UI-292/293/294/295 verified。诚实范围：重启后弹出窗不恢复（P1 plan 明示，geometry 持久化佐证）；static 5min 淡出由 railEntries 单测覆盖（实机不做 5min 等待）；「详情窗」入口按钮以数据面单测 + 同一 popOut IPC 实机驱动覆盖。0 新 npm 依赖；复用 `_window-create.js`/同一 SPA 路由/task_events 与 SSE 链（plan §10 治理红线全程守住：轨道/指挥中心/agent 窗全部只读投影，窗口永不持有 canonical state）。G0 开发期常态 · 不外推 packaged/Provider/GA。
