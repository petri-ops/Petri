---
capability: q2-context-assembly
goal: 把聊天 composer 的上下文引用从「三条互不复用的平行通道」收敛为单一 ContextItem 列表与单一渲染函数，并把统一 `@` 上下文菜单挂在这条唯一列表上——文件/文件夹、技能、MCP 连接器、Agent/子任务、结果产物、知识空间、历史会话八类候选同源、有上限、有来源标签、不可用如实提示；顺带把附件/引用超限的静默截断改为可见提示（C16）。
acceptance:
  - 行为冻结基线先行：`contextChannels.baseline.test.ts` 逐字钉住收敛前三条通道的输出形状（选中文段 / 图片引用 / 附件行块 + 三者组合顺序 + 各自上限 + 同源去重 + 截断提示 + 全角【】头），收敛后同一测试**逐字不变**才算纯组织重构（BLOCK-92 拆前基线拆后对账先例）。
  - 单列表收敛：`SimpleChat/contextItems.ts` 定义 `ComposerContextItem`（kind: selection | image | attachment | file | skill | connector | agent | artifact | knowledge | conversation）+ 唯一 `composeContextBlock(items)` + 唯一 `appendContextItem`（上限、去重、有界截断单源）；`selectionReferences.ts` / `imageReferences.ts` / `attachmentUpload.ts` 的 compose/append 不再被 SimpleChat 直接调用，各自保留为对应 kind 的构造器；`SimpleChat.tsx` 的三处引用组装（sendWithRefs / 排队 / Gen UI 追问）改为同一条 `composeContextBlock` 调用。
  - 不建第四注入通道：候选源一律产 `ComposerContextItem`，事件面复用既有 `petriEvents.selectionQuote` / `imageQuote`（`frontend/src/lib/events.ts:243-247` 的「D2 防第二注入通道」裁决继续有效）；上行形状仍是**正文内引用块**（模型可读），不新增第二份落库真相。
  - 统一 `@` 菜单：composer 输入 `@` 触发；候选八类同源聚合（文件/文件夹=工作区树端点、技能=`slashSources` 既有产品 Skills 源、连接器=`useMcpServers`、Agent/子任务=agent 任务面、结果产物=catalog/artifact 面、知识空间=知识空间面、历史会话=conversations 面）；每类带来源标签与逐项上限；键盘可达（上下/回车/Esc）；空结果与源不可用显示诚实原因，绝不静默吞掉。
  - 上限诚实化（C16 部分）：附件、选中引用、图片引用超限由「console.warn 静默截断」改为用户可见提示（单源文案），并保留既有「无项目时附件诚实报错」语义；`MAX_*` 常量全部收进一处定义。
  - 测试：前端组件/纯函数测试（基线冻结测 + contextItems 单列表语义 + `@` 菜单过滤/上限/来源标签/不可用提示 + 超限提示）+ 既有 `selectionReferences.test.ts`(6)/`imageReferences.test.ts`(5)/`attachments.test.ts`/`attachmentUpload.test.ts`/`slashSources.test.ts` 回归绿 + types 0 + `test:changed` 定向。
  - 实机腿：隔离 9223（mock provider）走「`@` 选文件 + 选技能 + 引用结果产物 → 发送 → 消息正文引用标签在场 → 模型请求体含引用块 → 移除一项后重发只剩余下引用 → 超限提示可见」+ 亮/暗截图；UI-553 台账 verified；closeout 十三门 PASS。
reopen: C13 速记板（需 SQLite 迁移 `src/migrations/016_*.sql`，独立包）、C12 划词动作生产者面（`WorkspaceFilePreview` 组件不存在，`selectionQuote` 目前是**有消费无生产**的半截管线）、C17 跨会话引用作为上下文资源（fork 后端已有，本包只做候选源里的「历史会话」引用形状）、C4 消息动作注册表化（`SimpleChatMessageRow.tsx` 369 行内联、全文件仅 1 个 testid）、B2 计划反馈输入、C11 图片保存/多图导航、G1+。
status: completed
---

# BLOCK-245 · Q2 首切片：上下文装配收敛 + 统一 `@` 菜单

> 用户裁决：2026-10-22「启动下一包 Q2 的开发」。
> 范围来源：`docs/qoder-essence-absorption-plan.md` §「Q2 — 上下文装配与捕获」+ §6.5 队列第 2 项（C4/C11/C12/C13/C15/C16/C17 + B2）。
> 本包只做 Q2 的**结构地基 + C15 统一 @ 菜单 + C16 上限诚实化**；其余 Q2 条目保持 planned，回写 §6.5 为 Q2-REM。

## 0. 立项判定（治理硬项）

### 0.1 产品个性自检（对标不改魂）

「这个能力的形态与 ZCode/Codex 的差别在哪？」

- **本地主权**：`@` 候选全部来自本机既有单源（工作区树端点、本地 Skills 目录、本机 MCP 货架、本地 SQLite 会话台账、Result Studio 产物），不引入任何云端目录或远端检索；候选解析失败时如实显示原因而不是回落到"猜一个"。
- **治理透明**：上下文**必须在场可见**——引用块在正文里对模型可读，同时在 composer 侧可逐项移除、有数量上限、有来源标签；超限不再静默截断（这是本包要清偿的一条既有缺陷：`attachmentUpload.ts:112-114` 只 console.warn）。
- **证据自证**：先冻结行为基线再动结构，基线测与实现同提交；实机腿断言「请求体里真的有引用块」，不停留在 UI 有 chip。
- 借的形：`@` 统一入口是 Codex/ZCode 的既有交互范式；自有形态＝八类候选的**同源聚合 + 有界 + 可审计**，不做无差别复刻。

### 0.2 patch vs refactor（判定发生在写码之前）

勘察实证（只读，带行号）：

| 面 | 事实 |
| --- | --- |
| 三条平行通道 | `SimpleChat/selectionReferences.ts`（上限 8 / 截断 8000 / compose 97-108）、`SimpleChat/imageReferences.ts`（上限 4 / compose 103-127）、`SimpleChat/attachmentUpload.ts`（compose 107-114）各有独立 state、独立 append/去重、独立上限常量、独立事件订阅 |
| 组装点 | `SimpleChat.tsx:1203-1206` 三层套嵌 `composeMessageWithImageReferences(composeMessageWithSelectionReferences(...)) + attachmentBlock`，另在两处旁路各自重复部分组装：`:1241`（排队只叠 selection）、`:1355`（Gen UI 只叠 selection） |
| 纪律重复 | 「引用头必须用全角【】，因为服务端 `cleanContent` 剥行首半角 `[...]`」同一条知识在 `selectionReferences.ts:93-96` 与 `imageReferences.ts:100-101` 各写一遍 |
| 后端读侧不同物 | `routes/harness/file-references.js:142-383` 解析的是**模型输出文本**里的 `petri://` URI（可点链接渲染），与上行注入不是同一条通道——不可误当复用点 |
| 半截管线 | `petriEvents.selectionQuote` 有消费者（`SimpleChat.tsx:347-353`）无生产者（注释点名的 `WorkspaceFilePreview` 组件不存在） |

命中重构信号（`$petri-project-governance` SKILL §"Judge patch vs. refactor"）：①同一处将接收第二次叠层修复（把 `@` 菜单挂到现有三通道 = 每个候选源要各自判断落哪条旧通道）；②需要既有概念的第二个变体（第三条/第四条注入通道）而不是泛化原结构；③绕过既有抽象并复制代码里已有的知识（头纪律写两遍）。

**结论**：先做收敛性重构（P1–P2），再挂新能力（P3–P4）。重构带行为基线（P1 冻结测），基线测在改结构前后都必须绿，且**不得**因为"看起来更合理"而修改基线断言。范围扩大由本包自身承担，不改别的包。

## 1. 范围与阶段

| 阶段 | 内容 | 出口断言 |
| --- | --- | --- |
| ✅ **P1 拆前基线**（commit `5e9e7ba4`）| `SimpleChat/contextChannels.baseline.test.ts`：对现有三条通道的纯函数输入/输出逐字快照（含组合顺序、上限、去重、截断文案、【】头） | 基线测先绿；此后任何改动都跑它 |
| ✅ **P2 三通道并一**（commit `fc1671cd`）| 新增 `contextItems.ts`：`ComposerContextItem` + `appendContextItem` + `composeContextBlock` + 单源上限常量；SimpleChat 的 refs 状态合并为单一列表；三处组装点改调同一函数 | P1 基线测**逐字不变**通过；SimpleChat 引用相关行数不增（`gate:code-size` 基线不放宽） |
| ✅ **P3 `@` 候选聚合**（commit `21299d13`）| `SimpleChat/contextSources.ts`：七源候选同形聚合（有界、带 `unavailableReason`/`note`/`truncated`），复用既有端点/hook，不新建后端读侧 | 单测 23 条：每源形状/上限/失败原因；无新依赖、无新存储 ✅ |
| ✅ **P4 `@` 菜单 UI**（commits `470315ca`/`ec8c4947`）| `SimpleChat/ContextMentionMenu.tsx`（触发/过滤/分组/来源标签/键盘可达/不可用诚实提示）+ composer 接入 + 选中即产 `ComposerContextItem` + 候选 chip 可见可移除 | 组件 7 + 交互 6；超限/无结果/源不可用三类提示可见 ✅ |
| ✅ **P5 上限诚实化（C16 部分）**（commit `2900b73b`）| 附件与引用超限由静默 `console.warn`/`slice` 改为用户可见提示（文案单源 `contextLimits.ts`）；跨组上限常量仍各在本域（附件 `MAX_ATTACHMENTS` / 引用 `CONTEXT_GROUP_CAPS`），文案集中不搬常量 | 单测断言"超限必可见且不丢已有项" ✅ |
| ✅ **P6 实机腿**（commit `d5075011`）| 隔离 9223 + mock provider：`@` 选文件/技能/结果产物 → 发送 → 请求体含引用块 → 移除一项重发 → 超限提示；亮/暗截图 | live 亮 22/22 · 暗 22/22；UI-553 verified ✅ |
| ✅ **P7 收口** | 定向/回归 + `output:judge` + closeout 十三门 + canonical 回写（plan/roadmap/handoff/AUDIT-LOG/UI 台账/Q-MATRIX C15/C16 行） | 十三门 PASS ✅ |

**批内纪律**：

1. 零新依赖、零新存储真相（速记板等持久面属 P4 之外的独立包）；
2. 不新增第四条「送文本进 composer」通道——复用既有事件名，候选源只产结构化 item；
3. 引用形状仍是正文内引用块（模型可读），不引入第二份"结构化引用"落库字段；若后续需要，必须先论证它不是第二真相；
4. `SimpleChat.tsx` 受 `gate:code-size` 棘轮（基线 2210），本包净增行数须 ≤0——新逻辑一律落 `SimpleChat/*` 子模块（BLOCK-244 的 `useApprovalSurfaces.ts` + `ApprovalSurfaces.tsx` 先例）；
5. 后端若有改动必须重启 dev 栈再验（配置键缓存教训见 closeout runbook）。

## 2. 非范围（不得顺手做）

- **C13 速记板**：需要 `src/migrations/016_scratchpad.sql` + CRUD + 搜索 + 来源会话；持久层判据见 `src/migrations/README.md`（用户数据表一律走迁移，禁代码内 CREATE TABLE）。独立包。
- **C12 划词动作生产者**：`selectionQuote` 的生产端组件（右栏文件预览划词）不存在，属"补一条缺失管线 + 新 UI 面"，与本包的收敛正交。
- **C4 消息动作注册表化**、**C11 图片保存/多图导航**、**B2 计划反馈输入**（`usePlanApprovalFlow.ts:83` 的 `keep-planning` 现在直接 return 不发消息，需新输入通路）。
- **C17 跨会话引用**的完整语义（带上限与不可用提示的会话资源模型）：本包只提供 `conversation` 候选形状。
- G1+：真实 Provider 矩阵、packaged 签名/公证、远程发布。

## 3. 验收门禁

1. **红绿顺序**：P1 基线测先绿（冻结现状）→ P2 收敛后同一测逐字绿 → 再写新能力测（新测允许先红后绿）。禁止为了让 P2 通过而放宽基线断言。
2. **前端**：`contextChannels.baseline` / `contextItems` / `contextSources` / `ContextMentionMenu` + 既有 `selectionReferences.test.ts` `imageReferences.test.ts` `attachments.test.ts` `attachmentUpload.test.ts` `slashSources.test.ts` 全绿；`npm run quality:types` 0。
3. **定向**：`npm run test:changed:list` 可复现（新路径同批登记 `test/impact-map.json`），`npm run test:changed` 0 红。
4. **实机**：隔离 9223 flow `ui553-context-mention-live`（mock provider，零真实 key），断言含「请求体真含引用块」与「移除后引用减少」两类反证；亮/暗截图入 `acceptance/ui-553/`。
5. **门禁**：`gate:code-size`（SimpleChat 不得增长）、`gate:css-modules`、`quality:lint`（棘轮不放宽）、`quality:knip:check`、`quality:secret`、`quality:arch`、`hygiene:check`、`docs:check`、`ui:audit:check` → `npm run closeout` 十三门 PASS。
6. **决策建议器**：台账回写前 `npm run doc:suggest`、规划测试前 `npm run test:suggest`、收口声明前 `npm run output:judge`（结果如实附交付说明，含零建议）。

## 4. 完成语义

completed = P1–P5 全部落地 + 基线逐字不变 + 前端/定向/live 证据 + UI-553 verified + closeout 十三门 PASS + canonical 回写（roadmap/handoff/AUDIT-LOG/UI 台账/Q-MATRIX C15 与 C16 行 + §6.5 Q2 行）。

只称「定向 + 专项门禁通过」，不称全量通过（根 `npm run check` 与 `test:all:workspace` 默认不跑）。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 5. 阶段进度（换 agent 接手锚点，2026-10-22 收工态）

| 阶段 | 状态 | 落点与证据 |
| --- | --- | --- |
| P0 立项 | ✅ | commit `83629ead`：plan + DOC-REGISTRY（`BLOCK-245-Q2-CONTEXT-ASSEMBLY` active/P0-LAUNCH）+ README 273 + AUDIT-LOG 启动行/记录行 + roadmap/handoff 恢复点 + UI-553 台账 in_progress |
| P1 拆前基线 | ✅ | commit `5e9e7ba4`：`SimpleChat/contextChannels.baseline.test.ts` 12 条逐字断言（三通道形状、组合次序 image→selection→text→attachment、上限 8/4、相邻同源去重、8000 截断文案、全角【】头纪律） |
| P2 三通道并一 | ✅ | commit `fc1671cd`：`contextItems.ts`（`ComposerContextItem` + 分组上限/去重 + 返回 `deduped`/`dropped` 信号 + 唯一 `composeContextMessage`）、`hooks/useComposerContext.ts`（列表状态 + 右栏引用事件订阅 + 三个组装入口）、`ComposerContextChips.tsx`（chip JSX 平移）+ 等价测与渲染锚点；`SimpleChat.tsx` 2210→**2121**（code-size 台账随批下调，总行数 −89）；P1 基线一字未改仍绿，定向前端 56/56、types 0、eslint 0 |
| P3 `@` 候选聚合 | ✅ | commit `21299d13`：`SimpleChat/contextSources.ts`（七源同形候选；逐源上限 12·6·6·6·6·4·6 + 硬上限 200；`unavailableReason`/`note`/`truncated` 三信号；`@` 触发解析与 token 摘除）+ `hooks/useContextSources.ts`（七个既有端点各自独立结算）+ `listConversationsStrict`（宽容版逐字不变，只为区分「源不可用」与「真零结果」）；单测 23 条 + 变异红证（去掉边界判据 → 1 红 → 恢复 23 绿） |
| P4 `@` 菜单 UI | ✅ | commits `470315ca`（主体）+ `ec8c4947`（补漏）：`ContextMentionMenu.tsx`（按源分组、来源标签、空结果/不可用原因/上限条数/有界 note；靠右缘锚定向左展开）+ `hooks/useContextMention.ts`（触发/过滤/↑↓ 回车 Esc/选中回落，选中只产 `ComposerContextItem`）；组件 7 + 交互 6；斜杠面板平移 `SlashCommandPanel.tsx`（零行为变化）；`SimpleChat.tsx` 2121→**2119**（基线随批下调）。补漏动因=实机准备期抓真：`@` 候选进了单列表却**无 chip 渲染**（用户看不见也移不掉），补 `others` 第三簇 |
| P5 上限诚实化 | ✅ | commit `2900b73b`：`SimpleChat/contextLimits.ts` 文案单源（附件超大/超量/引用超限/同源去重）；`attachments.onDrop` 由 `console.warn` + `slice` 改**返回可见文案**（体积与数量逐因拼接、已有附件一条不丢）；`useComposerContext` 消费 `deduped`/`dropped` → `notice`（state 与镜像收成单一写入口 `commit`）；测试 15 条 |
| P6 实机腿 | ✅ | commit `d5075011`：`scripts/block245-context-mention-live.mjs`（隔离 :3001/:3000/:9223 + mock provider 请求体留档 + 合成 done job 作结果源夹具）+ flow `ui553-context-mention-live.cjs`；**亮 22/22 · 暗 22/22**；反证链=请求体真含 4 条引用块 → 移除一条重发降为 2 条且不含【引用结果】→ 超上限提示可见。实机抓真两条（脚本侧修正）：①首启角色揭示浮层覆盖整页使截图失真（新增 `elementFromPoint` 命中断言）；②辅助链路（标题/记忆）复用同一 provider 导致"最后一次请求"数错引用块 |
| P7 收口 | ✅ | UI-553 → verified；Q-MATRIX C15 🟡→✅（C16 保持 🟡）、§6.5 第 2 行、§5 统计句漏回写一并纠正（✅40/🟡41/🔴14/⛔7=102）；closeout 十三门 + `output:judge`；canonical 回写见 §6 |

**遗留（reopen，非本包验收缺口）**

1. **C16 形态补全**：文件夹整体展开（现为目录条目引用）、选中代码块（选中文本已有）、应用快照。
2. **C13 速记板**（需 `src/migrations/016_*.sql`）、**C12 划词动作生产者**（`selectionQuote` 有消费无生产）、**C4 消息动作注册表化**、**C11 图片保存/多图导航**、**B2 计划反馈输入**、**C17 跨会话引用完整语义**——一律挂在本包收敛出的单一 `ComposerContextItem` 通道上，不另建第二条。
3. **数据面板的两处诚实边界**：工作区树 `recursive=1` 有 500 条上限（已以 `note` 如实提示「只覆盖前 500 项」）；结果产物腿的实机验证用**合成 done job**，真实工具链产物未在本包跑（真跑需生信依赖，与本包结构面无关）。
4. **技能源的失败原因不可细分**：`fetchSlashEntries` 内部按源降级（bridge 缺失/模板端点失败都表现为空），候选源沿用该口径，不二次猜测原因——若后续要细分，须先修 `slashSources` 本身（避免两份真相）。

**接手必读红线**（写在 plan §1 批内纪律，这里只提最容易破的三条）：零新依赖；**不建第四注入通道**（候选源只产 `ComposerContextItem`，事件面复用 `selectionQuote`/`imageQuote`，`events.ts:243-247` 的 D2 裁决有效）；引用上行仍是正文内引用块，**不新增第二份落库真相**；`SimpleChat.tsx` 新基线 **2119** 为棘轮上限（新逻辑一律落 `SimpleChat/*` 子模块）。

**非范围（别顺手做）**：C13 速记板（需 `src/migrations/016_*.sql`，判据见 `src/migrations/README.md`：用户数据表一律走迁移，禁代码内 CREATE TABLE）、C12 划词动作生产者（`selectionQuote` 有消费无生产，`WorkspaceFilePreview` 组件不存在）、C4 消息动作注册表化、C11 图片保存/多图、B2 计划反馈（`usePlanApprovalFlow.ts:83` 的 `keep-planning` 现在直接 return 不发消息）、C17 完整语义、G1+。

**Git 现状**：未推送（推送需用户单独发令），本地领先笔数以 `git rev-list --count origin/main..HEAD` 为准。本包提交=`83629ead` 立项 / `5e9e7ba4` P1 基线 / `fc1671cd` P2 并一 / `d4fc3d07`+`ac463923`+`ea79bfc4` 阶段回写 / `694125ff` ui-audit 门修直 / `21299d13` P3 / `470315ca` P4 / `2900b73b` P5 / `ec8c4947` P4 补 / `d5075011` P6；前一包 `90f17073` 是 BLOCK-244 收口。

## 6. 收口证据（P7）

- **前端定向**：`block245` 规则 13 个前端测试文件全绿（`contextChannels.baseline` 一字未改仍绿）；`quality:types` 0；`quality:lint` 0 error（本包新增 0 error，warnings 沿用仓库既有 `security/detect-object-injection` 族）。
- **实机**：`acceptance/ui-553/`（13 件）+ `acceptance/block-245/`（7 件），亮 22/22 · 暗 22/22。
- **治理**：`npm run closeout` 十三门 PASS；`npm run output:judge` 结论见交付说明。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
