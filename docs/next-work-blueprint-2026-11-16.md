# 下一阶段统一工作蓝图（Next-Work Blueprint · 2026-11-16）

capability: next-work-blueprint-2026-11-16
status: active
kind: living-plan
truthDomain: next-work-blueprint-2026-11-16
entrypoint: docs/next-steps-roadmap.md
lastUpdated: 2026-11-16

---

> 性质：**当前唯一 active 的执行蓝图**（living-plan，不占单包串行槽位）——把「接下来所有要做的事」按串行波次串成一张可恢复的清单。
> 发令：用户 2026-11-16「重整一下蓝图，覆盖接下来所有要做的事情」；2026-11-17「把已确认全部建议整合进蓝图、逐项细化拆解、给出可端到端自动推完的提示词」。
> **执行入口（2026-11-17 新增）**：本蓝图是战略层；可直接执行的任务卡见 [`docs/e2e-execution-plan-2026-11-17.md`](./e2e-execution-plan-2026-11-17.md)，可独立驱动全流程的提示词见 [`docs/E2E-PROMPT.md`](./E2E-PROMPT.md)。已确认建议整合清单（C1-C9）在执行方案 §0。
> 与既有 canonical 的关系：
> - `next-steps-roadmap.md` = 本蓝图的**当前下一步指针**（保持极简，指向本文件）。
> - `docs/g0-living-foundation-plan.md`（G0-LF）= 永久基础层常驻计划，与本蓝图正交，不重复登记。
> - `docs/pending-work-backlog.md` = 2026-10-31 历史队列快照（已降级），**不是**当前真相。
> - 历史蓝图（POST-H9 / M-BLUEPRINT / NEXT-STAGE-* 等）= completed/planned/reference，不复用为 active，避免第二真相源。
> G0 开发期常态 · 不外推 packaged/Provider/GA。

## 0. 当前状态锚点（恢复必读）

- `main` @ 当次 `git log -1`（蓝图创建于 `daaafd78`，体验原则确认后已前进；2026-11-17 origin UpdatePill 批已按用户裁决 rebase 同步并 push，HEAD 与 origin/main 一致）。
- **串行 active 工作包**：无（BLOCK-454 P1-P6 与插队包 BLOCK-455 P1-P5 均 completed；BLOCK-455=模型级能力声明 + Endpoint 能力面简化，UI-706 in_progress 待观感）。
- **未决 🔴/🟢**：无。
- **已知遗留红**：`docs:check` 1 红 = `post-h9-optimization-blueprint-2026-11-10.md` 换机缺失（Mac 是 untracked 原件，Win 未同步）——处置权在用户，非任何工作包引入。
- 排队候选（planned 规划大纲，非可执行）：POST-H9 优化蓝图 / 竞争力纲 / QODER 吸收。

## 0.5 设计宪法（Agent 能力体验设计原则 · 全波次适用）

> 用户 2026-11-16 裁决 5 条体验原则，确认版 + 补充约束见 [`docs/agent-experience-design-principles.md`](./agent-experience-design-principles.md)。**所有波次的设计与验收须过此宪法**。

- **P1 体验优先**：总步骤最少、真实产物交付；但省下的每步仍须留痕（P1-a 证据不可省）。
- **P2 自主范围**：在用户选定 accessMode（read/workspace-write/full/plan）内自主；**P2-a 红线=权限只认 UI 显式档位、禁止从消息文本推断**；P2-b 工具审批 allow/ask/deny/observe 与动态 guard 不放宽。
- **P3 自动化信息获取**：外部信息自动检索+API 调用，无需逐步指示；P3-a 来源可审计 / P3-b 失败诚实（不返回空数组冒充）/ P3-c 本地主权优先（SearXNG 默认，云 adapter 可选）。
- **P4 方案择优**：给一个最合理方案+依据，不罗列选项甩回用户；P4-a 判断可追溯 / P4-b 可覆盖、重大取舍显式点出。
- **P5 人工介入最小化**：仅信息不足/高风险/用户偏好时确认；**P5-a 护栏=ask/deny 调用、full 档破坏性操作、付费操作必须确认**；P5-b 偏好一次记住、P5-c 随时可接管。
- **横向约束 X1-X5**：全链可审计 / 失败诚实 / 幂等可回滚 / G0 不外推 / 差别形态自检（对标只借形不改魂）。
- **一句话**：体验到"少步骤、自动办、给最优解"，但**自主的边界由用户档位定、过程全链可审计、关键确认不省**——这是 Petri 对标 ZCode/Codex 时的差别形态。
- **延伸评估（已整合 2026-11-17）**：[`docs/product-function-frontier-and-minimal-design.md`](./product-function-frontier-and-minimal-design.md) 深度版——三层能力全景 + 四类现状诊断 + 三层信息架构。其 R1（机制显化率入宪法）已纳入本 §0.5 全局纪律；R2/R3 已纳入 W7 验收与范围；R1-R3 整合明细见 [`docs/e2e-execution-plan-2026-11-17.md`](./e2e-execution-plan-2026-11-17.md) §0。

## 1. 波次总览（串行，一包收口才开下一包）

| 波次 | 工作项 | 形态 | 状态 | 体量 |
|---|---|---|---|---|
| W1 | **BLOCK-454 P1** vision 修通 | active 包内阶段 | ✅ 已完成 2026-11-17 | 小（0.5 会话） |
| W2 | **BLOCK-454 P2** 搜索 adapter | 包内阶段 | ✅ 已完成 2026-11-17 | 中（1-2 会话） |
| W3 | **BLOCK-454 P3** OCR 窄口 + adapter | 包内阶段 | ✅ 已完成 2026-11-17 | 大（2-4 会话） |
| W4 | **BLOCK-454 P4** 文件输入链 | 包内阶段 | ✅ 已完成 2026-11-17 | 中 |
| W5 | **BLOCK-454 P5** Responses/Anthropic 协议 | 包内阶段（可选） | ✅ 已完成 2026-11-17（D3 预置=做；BLOCK-454 整包 completed，P6 暂缓不阻塞） | 中 |
| W6 | **BLOCK-454 P6** ASR/TTS | 包内阶段 | ✅ 已完成 2026-11-17（用户裁决「一次性搞完」启动；窄口+agent 工具+能力渠道槽位） | — |
| W7 | **设置页 IA v2 实施**（UI-704） | 新 UI 包 | ✅ 已完成 2026-11-17（实机腿 11/11；观感项需用户裁决不代签） | 中-大（1-2 会话） |
| W8 | **UI-703 收口**（API Endpoint 信息密度，实机观感） | 已提交 UI 包 | ✅ verified 2026-11-17（用户实机过目确认「顺了」；BLOCK-455 后表头已演进为 8 列+行详情，UI-706 承接） | 小 |
| W9 | **遗留治理清账**：post-h9 红（用户处置）+ 4 条失败后台任务 | 治理批 | 部分需用户裁决 | 小 |
| W10 | 排队规划大纲（POST-H9 / 竞争力纲 / QODER） | 候选池 | 需用户显式裁决另立子包 | 未定 |

> **串行纪律**：W1-W6 同属 BLOCK-454，严格 P1→P5 顺序，P6 暂缓不阻塞收口；W7/W9 要与 W1-W6 并行须用户显式裁决插队（当前默认 W1 先走）。W8 是观感过目，可在任意波次间隙由用户完成。

## 2. 各工作项详情（边界 / 依赖 / 验收 / 产物）

### W1 · BLOCK-454 P1 vision 修通
- **做什么**：定位安装版 `vision_failed: no_api_key` 成因（dev dataDir 中 vision 绑 deepseek 且 key 可用，安装版 `C:\Users\Admin\Documents\Petri-Local\ai-settings.json` 绑定不同）；修绑定口径 + 设置页指引。架构已有 family 归一，不新造管道。
- **契约源**：`docs/block-454-endpoint-contract-findings.md`（§3 vision 落点）。
- **验收**：有 key 的 deepseek profile 上识图不再 no_api_key；`image_url` 契约测试绿；不碰 provider 默认槽位。
- **产物**：`acceptance/block-454/p1/`（契约证据 + 绑定核实记录）。

### W2 · BLOCK-454 P2 搜索 adapter
- **做什么**：在 `web-search-provider.js` 窄口加 `deepseek-search` adapter（独立 `/v1/tools/search`：query/count/need_content，results[] 含 rerank_score/authority）；SearXNG 保持默认（本地主权）。
- **原则落实**：P3 自动化信息获取（Agent 自动检索无需逐步指示）+ P3-a 来源标签 + P3-b 失败诚实 + P3-c 本地主权（SearXNG 默认、DeepSeek 可选）。
- **依赖**：用户是否有 DeepSeek 搜索 key——无则只交契约级证据 + external-blocked 标注。
- **验收**：钳位/来源标签/未配置诚实报 `web_search_not_configured`/`cost.requests`+`cost.bytes`。
- **产物**：`acceptance/block-454/p2/`。

### W3 · BLOCK-454 P3 OCR 窄口 + adapter
- **做什么**：新建独立 `ocr(file,options)` 工具窄口（不塞进 registerProvider capabilities）；DeepSeek OCR adapter（`/v1/tools/ocr` multipart，响应 `pages[].text` + 版面标记）；本地 OCR 路保留离线优先。
- **原则落实**：P1 体验优先（扫描件自动解析、用户零手工转录）+ P1-a 产物留 artifact + P3-c 本地主权（离线 OCR 优先）；X3 幂等可回滚（批量识别）。
- **决策点**：本地 OCR 引擎（tesseract/PaddleOCR）须用户裁决（新依赖，默认 no）；扫描件样本。
- **验收**：窄口契约测试 + 扫描件 PDF knowledge 集成测试；按页成本走 `cost.requests`；artifact 留痕。
- **产物**：`acceptance/block-454/p3/`。

### W4 · BLOCK-454 P4 文件输入链
- **做什么**：Files API（`POST /files` + `file_id` 引用）与 knowledge 解析对接；对话内联文件块按协议归一（Chat `file` / Responses `input_file` / Messages `document`）。
- **验收**：file_id 引用链契约测试 + 一轮真实文档问答证据（无样本则契约级 + 诚实标注）。可并入 W3 收尾。
- **产物**：`acceptance/block-454/p4/`。

### W5 · BLOCK-454 P5 Responses / Anthropic 协议（可选）
- **做什么**：Responses adapter（官方 `/responses` 原生支持，Petri 当前 0 命中）；Anthropic Messages adapter（`anthropic.js`）已支持 baseUrl 指向 `/anthropic`，属配置态零代码。内联 `deepseek_web_search`/`deepseek_read_url`/`safety_check`/`title` 若走 Responses 统一映射；safety_check 不替换本地治理。
- **前置**：findings 标 UNVERIFIED 的「Responses 完整请求形态」开写前补抓官方文档。
- **依赖**：用户裁决是否要 Responses 协议。
- **产物**：`acceptance/block-454/p5/`。

### W6 · BLOCK-454 P6 ASR / TTS（暂缓）
- **状态**：官方契约已核实（`/v1/tools/asr`、`/v1/tools/tts` + 流式 WS），但 Petri 无消费方。缺的是需求不是实现。
- **触发**：用户给出明确场景（语音输入 / 朗读回复）才启动；不因"全家桶齐全"为接而接。P6 暂缓不阻塞 BLOCK-454 整体收口。

### W7 · 设置页 IA v2 实施（建议 UI-704 —— 实施时先核对台账未占用号）
- **设计源**：`docs/settings-ia-simplification-design.md`（v2 激进版）+ `docs/agent-experience-design-principles.md`（设计宪法）。
- **做什么**：左栏 core 13→5 组 + 1「高级」折叠组（治理/推理/联网/远程/快捷键/诊断/实验搜索可达）；**全局设置搜索**（借鉴 orca `Cmd-,`）；**页面内 UpdateCard**（复用 `useAutoUpdate` + `app:notify`，仿 orca `UpdateCard.tsx`）；联网代理降级、快捷键移出核心；BLOCK-454 adapter 统一进 models「能力渠道」折叠。
- **原则落实**：P1 体验优先（core 精简、少找少点）+ P4 方案择优（更新主动呈现而非罗列设置项让用户找）+ P5-b 偏好记忆（一次告知后续不扰）+ P2 护栏不破（治理项仍在高级组可达，不放宽审批）。
- **深链兼容**：`?section=network|keymap|general|...` 旧值映射有效，不失效。
- **验收**：core 5 组契约测试；快捷键/联网不在 core 首屏但搜索可达；UpdateCard 页面内出现且可关闭；theme-token-contract + ui:audit:check 绿；实机截图过目（观感不代签）。
- **串行**：需等 BLOCK-454 收口或用户裁决插队。

### W8 · UI-703 收口（API Endpoint 信息密度）
- **状态**：✅ verified（2026-11-17 用户实机过目确认「顺了」，台账已翻 verified 并出籍）。后续 BLOCK-455 把主表演进为 8 列+行详情折叠，观感由 UI-706 承接（in_progress 待用户过目）。
- **边界**：观感归用户，Agent 不代签。

### W9 · 遗留治理清账
- **post-h9 红**：`docs/post-h9-optimization-blueprint-2026-11-10.md` 在 Mac 是 untracked 原件，Win 未同步 → 用户取回提交（或裁决从 registry 摘除）+ coverage 重算；非产品缺陷。
- **4 条失败后台任务**：`vite-ui701`（被清理的临时 vite）、3 条 build-win 失败（SDK 缺失期历史）——均为已解决问题的过程产物，用 `npm run task:status` 对账后清账，不影响功能。

### W10 · 排队规划大纲
- POST-H9 优化蓝图 / 竞争力纲 / QODER 吸收——均为 `planned` 规划大纲，需用户显式裁决另立子包才可执行；不在当前波次自动推进。

## 3. 依赖与决策点清单（需用户裁决）

| # | 决策点 | 关联波次 | 默认 |
|---|---|---|---|
| D1 | 本地 OCR 引擎是否引入新依赖 | W3 | 默认 no（仅云 adapter），离线路需用户批准 |
| D2 | 是否有 DeepSeek 搜索 key（决定 W2 实机腿） | W2 | 无 → 契约级证据 + external-blocked |
| D3 | 是否做 Responses 协议 | W5 | 不做（可选阶段暂缓） |
| D4 | 设置页 IA 插队还是排队 | W7 | 排队（W1-W6 先走） |
| D5 | post-h9 原件取回 vs registry 摘除 | W9 | 用户处置，Agent 不擅改 |
| D6 | W7 全局设置搜索的快捷键绑定（`Cmd-,` 还是 `Ctrl+,` 或自定义） | W7 | 随平台默认，实施时定 |
| D7 | ASR/TTS 需求场景 | W6 | 暂缓 |

## 4. 完成语义

- BLOCK-454（W1-W5）逐阶段验收门禁对账 + acceptance 证据落盘 + canonical 回写后才 completed；P6 暂缓不阻塞。
- W7 独立 UI 包收口（verified 需实机+用户过目观感）。
- W8 用户过目后翻 verified。
- W9 治理清账完成、docs:check 绿（或 post-h9 红按用户裁决保留并登记）。
- 每波次收口后更新本蓝图波次状态 + roadmap 指针 + handoff + AUDIT-LOG；新包开工照立项检查单。

G0 开发期常态 · 不外推 packaged/Provider/GA。
