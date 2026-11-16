# 端到端自动执行方案（E2E Execution Plan · 2026-11-17）

status: active
kind: reference
truthDomain: e2e-execution-plan-2026-11-17
entrypoint: docs/next-steps-roadmap.md
lastUpdated: 2026-11-17

---

> 发令：用户 2026-11-17「将此前讨论中已确认的全部建议完整整合进项目蓝图，并对蓝图中每一项工作做细化拆解，形成可直接执行的完整方案；给出一个可一次性端到端自动推完的提示词，全程无需人工介入；覆盖执行流程/各阶段任务与交付物/依赖/自动化运行条件/异常与失败处理/验收标准/最终成果」。
> 性质：**执行方案 canonical**——把统一蓝图（`docs/next-work-blueprint-2026-11-16.md`）的 W1-W10 细化为可直接执行的任务卡，并把所有"待裁决点"预置为一次性默认裁决，使端到端无人值守成为可能。
> 配套产物：`docs/E2E-PROMPT.md` = 可独立驱动全流程的提示词（本方案的机器可执行入口）。
> G0 开发期常态 · 不外推 packaged/Provider/GA。

## 0. 已确认建议的完整整合清单（本次一次性纳入蓝图）

| # | 已确认项 | 来源裁决 | 整合去向 |
|---|---|---|---|
| C1 | 通用能力窄口 + DeepSeek 作为第一个 adapter（非全家桶绑定） | 用户「按照你的建议来」「先立项」 | W1-W6（BLOCK-454） |
| C2 | DeepSeek 端点契约核实（P0 已完成，findings 已出） | 用户「全方位列举」 | 已完成，作为 W1-W6 硬门输入 |
| C3 | Agent 体验设计原则 5 条 + P1-a/P2-a-b/P3-a-b-c/P4-a-b/P5-a-b-c + X1-X5 | 用户给 5 条，我方确认细化，用户继续推进 | 蓝图 §0.5 设计宪法（已入） |
| C4 | 设置页 IA v2：联网降级/快捷键移出/更新页面内 + 对标 orca/codex | 用户三条明确裁决 | W7 |
| C5 | 三层能力全景 + 四类现状诊断（A可见/B不可见/C占位/D真缺）+ 三层信息架构 | 用户「重新梳理，尽可能发挥能力」 | 写入蓝图 §0.5 + W7 验收 |
| C6 | R1 机制显化率入宪法 / R2 三层架构为 W7 验收 / R3 命令面板单一入口 | 我方建议，用户「全部已确认建议整合」 | R1→§0.5，R2/R3→W7 |
| C7 | UI-703 信息密度（撞号已纠正） | 已提交 | W8 |
| C8 | 遗留治理（post-h9 红 + 失败后台任务） | 已登记 | W9 |
| C9 | **端到端无人值守自动推完** | 用户本次裁决 | 本方案 + E2E-PROMPT.md |

## 1. 自动化运行总条件（端到端前置）

### 1.1 启动前置（硬门，任一不满足则停在起点并报告）
- Git：工作区干净（无 tracked 修改、无 untracked 用户资产）；HEAD 与 origin/main 一致。
- AUDIT-LOG：无 🔴 阻塞；🟢 无未决。
- 唯一 active 槽位 = BLOCK-454（本方案就是推它，一致）。
- canonical 文档可读：`next-work-blueprint-2026-11-16.md` / `block-454-capability-adapters-plan.md` / `block-454-endpoint-contract-findings.md` / `agent-experience-design-principles.md` / `settings-ia-simplification-design.md` / `product-function-frontier-and-minimal-design.md`。
- 环境：Node 24（fnm）+ npm；Windows 打包环境已备（SDK 10.0.26100 已装，见历史登记）；Git Bash 前置 PATH（dev-infra §9 环境坑）。

### 1.2 预置裁决（用户一次性授权，运行时不再逐点询问 —— 这是无人值守的关键）

> 用户本次"全程无需人工介入"= 对下列决策点的**一次性显式裁决**，运行时按默认执行并在 AUDIT-LOG 留痕；遇**新依赖/破坏性操作/质量红线**按 dev-infra 纪律本应停，但本次授权把这些点预置为"默认路径 + 留痕"，不再中断。

| 决策点 | 预置默认裁决（自动执行） | 留痕方式 |
|---|---|---|
| D1 本地 OCR 引擎新依赖 | **默认 no**——W3 只做 DeepSeek 云 adapter + 通用窄口，本地 OCR 留接口不引依赖 | W3 plan 注明"离线路 deferred，未引依赖" |
| D2 DeepSeek 搜索 key | **默认无 key**——W2 交契约级证据 + external-blocked 标注，不做真端点实机腿 | W2 证据 JSON 标 `external-blocked: no-key` |
| D3 Responses 协议 | **默认做**——W5 不再可选跳过，纳入自动序列（契约先补抓 UNVERIFIED 项） | findings 补抓记录 + W5 证据 |
| D4 设置页 IA 插队 | **默认不插队**——W1-W6 收口后再 W7（单包串行纪律） | 蓝图波次状态顺序执行 |
| D5 post-h9 红 | **默认保留红 + 登记**——不擅改 registry、不摘除（用户资产），W9 只清可自动清的 | AUDIT-LOG 保留既有红说明 |
| D6 设置搜索快捷键 | **默认随平台**（macOS Cmd+, / Win Ctrl+,） | W7 实现按 platform 判定 |
| D7 ASR/TTS | **默认暂缓**——W6 不启动，P6 保持 deferred | 蓝图 P6 状态不变 |
| D8 W8 宽表头观感过目 | **默认以用户后续确认收口，不代签**——W8 在自动序列中标记为"待外部确认"，不阻塞其他波次 | UI 台账保持 in_progress |

### 1.3 自动化纪律（全过程遵守）
- **单包串行**：同一时刻只一个工作包 active；波次内按任务卡顺序，不并行开新包。
- **HK-01 红绿先行**：每个新行为契约先落失败测试再写实现；纯文档/契约核实豁免。
- **Gate 链**：每个实现包收口跑 `npm run closeout`（文档类跑 docs:check + docs:reconcile）；专项门按各任务卡声明。
- **canonical 回写**：每波次收口同提交更新 六件套（plan 状态 / 蓝图波次 / roadmap 指针 / handoff / AUDIT-LOG / 相关台账）。
- **失败处理**：见 §4；核心原则 = fail-closed、诚实标注、不伪造通过、不静默吞错。

## 2. 执行流程总览

```
START → 前置硬门检查(§1.1)
  → 逐个波次 W1..W9 串行执行（每波次 = 任务卡 4 步：红绿灯→实现→门禁→回写）
    → W1 vision → W2 search → W3 OCR → W4 file → W5 responses
    → W7 settings-IA → W9 governance-cleanup
    → W8 标记待用户过目（不阻塞）
  → 全波次完成语义核对(§5)
  → 最终交付物打包(§6)
  → END
```

> W6(ASR/TTS) 按 D7 默认暂缓、W10(规划大纲) 需显式裁决另立包——两者不在自动序列内，但在最终报告里明确列出"未执行项 + 原因"。

## 3. 任务卡（逐项细化：步骤 / 交付物 / 依赖 / 门禁 / 验收）

### W1 · BLOCK-454 P1 vision 修通
- **输入**：findings §3 vision 落点；安装版 ai-settings.json 路径。
- **步骤**：①读安装版 + dev 版 ai-settings.json（脱敏）对比 vision/embedding 绑定 → ②定位 no_api_key 成因（绑定缺失 or key 可用性）→ ③若绑定问题：修设置页指引/绑定口径（不新造管道，复用 OPENAI_FAMILY 归一）→ ④加 `image_url` 契约测试。
- **交付物**：修复代码（若需）+ 契约测试 + `acceptance/block-454/p1/`（绑定核实记录 + 测试结果）。
- **依赖**：无（队首）。
- **门禁**：相关定向测试全绿 + quality:types + docs:check。
- **验收**：有 key 的 deepseek profile 上识图不再 no_api_key；契约测试绿；provider 默认槽位未动。
- **失败分支**：若无 key 导致无法实机 → 标 external-blocked，交契约级证据，继续（按 D2 同款诚实原则）。

### W2 · BLOCK-454 P2 搜索 adapter
- **步骤**：①按 findings `/v1/tools/search` 契约写 deepseek-search adapter（query/count/need_content；响应 results[] 归一到现有 search 结果形状）→ ②HK-01：先写失败测试（钳位/来源标签/未配置诚实报/成本计量）→ ③实现 → ④SearXNG 默认不变。
- **交付物**：adapter 代码 + 契约测试 + `acceptance/block-454/p2/`。
- **依赖**：W1 收口。
- **门禁**：定向测试 + secret/arch（无新依赖）。
- **验收**：钳位/来源标签/`web_search_not_configured` 诚实报/`cost.requests`+`cost.bytes` 计量；无 key 按 D2 标注。
- **失败分支**：契约细节不符 → 回 findings 标注 UNVERIFIED，降级为窄口骨架 + 诚实报，不硬接。

### W3 · BLOCK-454 P3 OCR 窄口 + adapter
- **步骤**：①建 `ocr(file,options)` 通用窄口（工具语义，不进 registerProvider capabilities）→ ②HK-01 测试 → ③DeepSeek OCR adapter（multipart file+purpose，响应 pages[].text + `<｜ref｜>/<｜box｜>` 版面标记）→ ④knowledge 扫描件 PDF 接入 → ⑤成本按页走 cost.requests + artifact 留痕。
- **交付物**：窄口模块 + adapter + knowledge 集成 + 测试 + `acceptance/block-454/p3/`。
- **依赖**：W2；D1 默认 no（不引本地 OCR 依赖）。
- **门禁**：定向测试 + knowledge 邻域 + quality:arch。
- **验收**：窄口契约 + 扫描件集成测试绿；无样本则契约级 + 诚实标注；artifact 留痕在案。

### W4 · BLOCK-454 P4 文件输入链
- **步骤**：①Files API（POST /files + file_id）与 knowledge 解析对接 → ②对话内联文件块按协议归一（Chat `file` / Responses `input_file` / Messages `document`）→ ③契约测试 → ④一轮真实文档问答（无样本则契约级）。
- **交付物**：文件链代码 + 测试 + `acceptance/block-454/p4/`。
- **依赖**：W3（可并 W3 尾收口，但仍单独产物）。
- **门禁**：定向测试 + types。
- **验收**：file_id 引用链绿；file_id 跨会话归属校验在 win32 不空转（BLOCK-196 先例）。

### W5 · BLOCK-454 P5 Responses 协议（D3 默认做）
- **步骤**：①补抓 findings UNVERIFIED 的「Responses 完整请求形态」官方文档 → ②Responses adapter（/responses）→ ③内联 deepseek_web_search/read_url/safety_check/title 映射 → ④safety_check 不替换本地治理 → ⑤契约测试。
- **交付物**：adapter + 补抓的契约记录 + 测试 + `acceptance/block-454/p5/`。
- **依赖**：W4；补抓文档是前置（未取得则本步 external-blocked，不硬写）。
- **门禁**：定向测试 + docs:check（findings 更新）。
- **验收**：Responses 请求/响应形态契约绿；内容块（thinking/tool_use/citations/refusal）投影不丢。

### W7 · 设置页 IA v2 实施（UI-704 或下一个未占用号）
- **步骤**：①核对台账取未占用 UI 号 → ②HK-01 契约测试（core 5 组 + 深链映射 + 搜索可达 + UpdateCard）→ ③左栏 core 13→5 + 高级折叠组 → ④全局设置搜索（复用 CommandPalette.tsx）→ ⑤页面内 UpdateCard（复用 useAutoUpdate + app:notify）→ ⑥R2 三层信息架构落到设置/主界面验收 → ⑦深链映射 → ⑧theme-token-contract + ui:audit + 实机截图。
- **交付物**：代码 + UI 契约测试 + `acceptance/ui-704/` + UI 台账条目。
- **依赖**：W5 收口（D4 默认不插队）。
- **门禁**：theme-token-contract + ui:audit:check + types + 定向测试。
- **验收**：core 5 组；快捷键/联网不在首屏但搜索可达；UpdateCard 出现可关闭；深链不失效；观感项标 in_progress 不代签。

### W8 · UI-703 收口（标记，不阻塞）
- **动作**：在最终报告标记"UI-703 宽表头观感待用户过目，台账保持 in_progress"；不代签、不阻塞其他波次。

### W9 · 遗留治理清账
- **动作**：①`npm run task:status` 对账 4 条失败后台任务，确认均为已解决问题的过程产物后登记清账 → ②post-h9 红按 D5 保留 + AUDIT-LOG 说明（不擅改 registry）→ ③docs:check 复核只剩既有红。
- **交付物**：AUDIT-LOG 清账行 + 任务状态记录。

## 4. 异常与失败处理机制（统一契约）

| 异常类型 | 处理动作 | 禁止 |
|---|---|---|
| 契约抓不到（文档 404/变更） | 标 UNVERIFIED + external-blocked，降级为窄口骨架或跳过该子步，AUDIT-LOG 留痕 | 禁止按猜的请求体硬写 |
| 无 key / 无样本 | 交契约级证据 + external-blocked 标注 | 禁止伪造实机通过 |
| 测试红（实现缺陷） | 修根因 + 复跑；不通过不进下一波次 | 禁止跳过门禁 |
| 测试红（Windows 环境存量债） | 单跑复现 → 确认不引用本模块 → 归属登记 → 继续 | 禁止误判为本包引入 |
| 新依赖需求 | 按 D1 默认 no，留接口不引依赖 | 禁止擅自加依赖 |
| 破坏性/不可逆操作 | fail-closed，拒绝并记录 | 禁止无授权执行 |
| 文档门禁红 | 区分本轮引入 vs 既有红：本轮引入必修，既有红登记保留 | 禁止改基线掩盖 |
| 质量红线（fail-closed 门红） | 停在该波次，报告 | 禁止带着红声明完成 |

> **核心原则**：失败诚实（X2）；不伪造通过；external-blocked 与契约级证据是合法终态，不是缺陷。

## 5. 验收标准与完成语义

### 5.1 每波次收口检查（逐项对账）
- 任务卡步骤全部执行或有明确 external-blocked 标注；
- 交付物落盘（代码 + 测试 + acceptance 证据）；
- 门禁绿（或既有红归属清楚）；
- canonical 六件套同提交回写；
- AUDIT-LOG 有该波次记录行。

### 5.2 整体完成语义
- W1-W5（BLOCK-454 P1-P5）逐阶段验收 + acceptance 落盘 → BLOCK-454 标 completed（P6 暂缓不阻塞）；
- W7 UI 包收口 → UI 台账条目建立（实机观感项 in_progress 不代签）；
- W9 清账完成，docs:check 只剩既有 post-h9 红；
- W8/W6/W10 在最终报告明确列出"未执行/待外部 + 原因"。

## 6. 最终交付成果（完整清单）

1. **代码产物**：vision 绑定修复（若需）、deepseek-search adapter、ocr 通用窄口 + adapter、文件输入链、Responses adapter、设置页 IA v2 代码（core 5 组 + 搜索 + UpdateCard）。
2. **测试产物**：每步 HK-01 红绿测试、UI 契约测试、theme-token-contract、邻域回归。
3. **证据产物**：`acceptance/block-454/p1..p5/`、`acceptance/ui-704/`，每个含结果 JSON + 必要截图/契约记录。
4. **文档产物**：findings 补抓更新、蓝图波次状态更新、BLOCK-454 plan 阶段回写、UI 台账新条目、AUDIT-LOG 各波次记录、handoff/roadmap 指针更新。
5. **治理产物**：每波次 git commit + push；最终一次全量 closeout 读数；W9 清账记录。
6. **最终报告**：执行摘要（各波次结果）、未执行项清单（W6/W8/W10 + 原因）、external-blocked 清单、剩余既有红、下一步建议。

## 7. 诚实边界

- 本方案是**预置裁决的一次性授权**：D1-D8 的默认路径由用户"全程无需人工介入"授权；若运行时出现**超出预置的新裁决点**（如安全红线、用户资产、未预期破坏性操作），按 dev-infra 纪律停下报告——这是保护，不是失败。
- "端到端自动推完"指 W1-W5 + W7 + W9；W6/W8/W10 按预置默认不执行（暂缓/待外部/需另立包），但在最终报告明确列出。
- 本方案不宣称任何尚未执行的 verified；所有状态以执行时的 Git/测试/证据为准。

G0 开发期常态 · 不外推 packaged/Provider/GA。
