---
capability: next-phase-e2e-prompt-20261118-b2
status: active
goal: 下一阶段无人值守提示词（2026-11-18 批 2）——上一批 S1-S5 全收口后，承接 Jev 单一建议 C-53-P2，按单工作包串行推进 C-53 UI 设计质量剩余阶段 P2→P7（P7 人眼收口仅非观感准备、签字留用户）+ Polyfork 授权材料只读收集附线；预置裁决免人工介入，观感零代签；自包含可复制，配套说明见 §3
acceptance:
  - 自包含：新 Agent 复制 §2 代码块整块即可无人值守推进，无需外部上下文
  - 覆盖七要素：核心目标/交付物、任务清单与顺序、自动推进触发与依赖、每任务完成标准、异常降级策略、输出格式与进度汇报、边界约束
  - 预置裁决逐项留痕（用户 2026-11-18 授权性质）+ 两条绝对红线 + 用户动作清单
  - 范围严格对齐 Jev 单一建议 C-53-P2 与 C-53 权威阶段定义（AUDIT-LOG 119 行），不越 G1+/不代签观感
  - 本文件=提示词入口（canonical 指针），正文自包含不依赖本文件其余内容
---

# 下一阶段无人值守提示词（2026-11-18 批 2 · C-53 剩余阶段）

> **背景**：上一批（`docs/next-phase-e2e-prompt-2026-11-18.md`）S1–S5 已全收口（BLOCK-465/466/467/468/469，2026-11-18），串行 active 槽位回空。本文件是**下一阶段**的无人值守执行提示词入口；**正文在 §2 代码块内，自包含**——复制整块给新 Agent 即可。
> **发令**：用户 2026-11-18「为下一阶段的工作设计一个无人值守（全自动）执行的详细提示词，使工作能够自主推进而无需人工干预」。
> **范围依据**：Jev 单一建议 = C-53-P2（confidence=0.58，2026-11-18 收尾实测）；C-53 权威阶段定义见 `docs/AUDIT-LOG.md` C-53 规划条目（P0/P1 已由 BLOCK-465 完成）。

## §1 剩余工作盘点（2026-11-18 现读，提示词执行前不再复述）

- **可自动（本提示词范围）**：C-53 P2 IA 与高频路径 → P3 视觉一致性 → P4 响应式与可访问性 → P5 性能与可信状态 → P6 产品 Skill v1.1 → P7 人眼收口的**非观感准备部分**；Polyfork 授权材料只读收集（R6 遗留，材料齐即停、接入决策归用户）。
- **需用户（Agent 不代答不代签）**：C-53 P7 人眼签字（观感）；观感签字 UI-706/707/709/710 + E 类人眼 22 条；Polyfork 授权边界结论与接入决策；post-h9 D5 原件处置。
- **既有红（本批可清偿部分）**：`test-affected.test.mjs:90` block464 evidence gap（纯测试面债务，归属既有，本批不碰，除非命中 C-53 改动域）；`quality:perf` packaged_start 继承抖动（G0 边界噪声，不重打基线）。
- **候选池（仅登记不开工）**：C-50 / C-52 余项 / C-45 / C-47 / MIGRATION-IDEMPOTENT / C-55（P4-REM 最后、Q4b 单列）。

## §2 提示词正文（复制以下代码块整块给新 Agent）

```text
你是 Petri Desktop 项目的全自动执行 Agent。用户预授权「不需要人参与，按本提示词阶段性推进下一阶段工作」。
除 §3 两条绝对红线外，不得中途提问、不得等待确认。

## 0. 核心目标与交付物
在 docs/petri-master-charter.md（全局稳定顶层）约束下，按单工作包串行推进 C-53 UI 设计质量剩余阶段（P2→P7），
并把上一批遗留的 Polyfork 授权材料只读收集（R6）作为独立附线收口。
交付物：
  ① 每个阶段一个 completed/CLOSED 的 work-package + 六件套 canonical 回写
     （plan / next-work-blueprint / roadmap / handoff / AUDIT-LOG / DOC-REGISTRY）；
  ② 每阶段证据落 acceptance/<step>/；
  ③ P7 人眼收口仅做非观感准备（清单+证据索引），签字槽留用户；
  ④ 最终报告 + 固定下一步提示（Jev 单一建议 + 母纲波次 + 蓝图进展）。
原则：能自动的全自动、失败诚实降级、只有两条绝对红线才停。

## 1. 启动恢复（必须先做，顺序执行；任一硬门不过则按 §7 降级，不硬闯）
1. 加载 skills：petri-project-governance、petri-dev-infra；涉 UI/样式加载 petri-css-theme，
   涉代码评审加载 petri-code-review（本批 S1-S4 为 UI 面 → 必加 petri-css-theme）。
2. npm run state；读 docs/AUDIT-LOG.md 头部（🔴 先处理、🟢 待合并）、docs/petri-master-charter.md、
   docs/next-work-blueprint-2026-11-16.md、docs/design-charter.md、
   docs/next-phase-e2e-prompt-2026-11-18-b2.md §1（本批盘点）、
   docs/AUDIT-LOG.md 的 C-53 规划条目（P0–P7 权威定义）、resources/design-context/（P1 上下文包真源）。
3. 硬门：AUDIT-LOG 无 🔴；origin/main 已同步（git fetch 后 ff-only 合并）；工作区无未知他方 WIP
   （git status 核对；untracked 用户资产——post-h9 原件 / petri-logo* / tmp-* / assets / model3d 原件等——零触碰）。
4. 环境：Node 24（fnm）；9223 离屏实例纪律（跑完即 kill、禁 PETRI_TEST_ONSCREEN）；
   Jev cloud 已修（package.json 四脚本带 NODE_USE_ENV_PROXY=1，若仍报 http_error:cloud
   按 .agents/skills/petri-dev-infra/references/JEV-CLOUD-PROVISIONING.md §2 诊断）。
5. 判据现读：确认 P0/P1 已完成（BLOCK-465 completed/CLOSED、resources/design-context/manifest.json 在场），
   确认 C-53 P2–P7 各阶段真源在场（见 §5 依赖列）；缺真源按 §7 external-blocked 判档，不臆造。

## 2. 预置裁决（用户 2026-11-18「设计下一阶段无人值守提示词」授权，运行时按此执行，禁止再问）
- R8 C-53 发令 = P2–P6 全自动推进 + P7 非观感准备；P7 人眼签字留用户，不代签（沿 R1 红线精神）。
- R9 P2 IA 与高频路径 = 首片：从 App.tsx/pages/ 机械盘点 IA 映射 + 3–5 条高频路径，
  产模型可读 IA 映射（沿 resources/design-context 先例）+ 消费测试锚定；观感留槽。
- R10 P3 视觉一致性 = design-charter token 落地机械扫描（禁 slate 字面量/海军蓝 token 阶梯/禁零定义/
  颜色预算），扩展 theme-token-contract；不写样式观感面，违规红或入册。
- R11 P4 响应式与可访问性 = a11y 机械契约扩展（键盘/焦点/ARIA/对比度/触摸目标/断点存在性），
  复用 frontend/src/themes/nso-w3-a11y.test.tsx + test/ui-design-a11y.test.mjs；视觉美观留槽。
- R12 P5 性能与可信状态 = 加载/空/错误/流式可信态状态机契约（复用 BLOCK-154 memo 边界 +
  BLOCK-466 流式占位：partial spec 不闪烁/首屏占位/断线续传兼容断言在册）；动画观感留槽。
- R13 P6 产品 Skill v1.1 = resources/skills/design-brief（README.md）契约升级，消费 design-context +
  IA 映射 + a11y 约束；.agents/skills/petri-ui-design/SKILL.md 对齐走发现桥 symlink；skills:check 绿。
  注意：design-brief 实体在 resources/skills/design-brief/（非 SKILL.md 命名），改前先读其结构。
- R14 Polyfork = 只做授权材料只读收集（官方条款/许可页抓取存 acceptance/polyfork-license-materials/，
  逐条摘录原文+链接）；授权边界结论与接入决策仍归用户（红线 2——材料齐即停，不接入、不装包）。
- R15 每步收口照常走 closeout 定向门禁 + 六件套回写 + commit + push；观感项永不写 verified。

## 3. 两条绝对红线（唯一允许停下的情况，不可绕过）
红线 1 · 观感不代签：任何 pending_human_eye 项（UI-706/707/709/710、E 类人眼 22 条、
C-53 P7 人眼收口、本批新 UI 面的观感）——保持 in_progress，如实标注「待用户实机过目」，
永不写 verified、永不代签。可完成其非观感部分（代码/门禁/证据），签字槽留空。
红线 2 · C 类保护停止：安全红线、破坏性操作、数据丢失风险、用户资产处置
（post-h9 原件 / petri-logo / tmp-* / assets / model3d 原件等 untracked 资产零触碰）、
超出预置的新裁决点（含 Polyfork 授权结论与接入决策、design-charter 冻结档位/预算变更、
任何产品级新依赖、G1+ 工作）——立即停止并在最终报告列出，不为「推进」绕过。
除此之外一律不因「需要人」而停。

## 4. 全局纪律
- 单工作包串行：同时一个 active 工程包；S1→S7 按序，前一步收口才进下一步；不并行开新包。
- HK-01 红绿先行；失败诚实（external-blocked / 契约级证据是合法终态）；不伪造通过、不改基线掩盖。
- 每阶段收口：定向测试 → 专项门 → 证据落 acceptance/ → 六件套回写 → commit + push。
- 依赖纪律：零新增产品依赖默认；任何产品级新依赖=红线 2 停。
- 定向优先：默认只跑与改动相关测试（npm run test:changed:list / test:changed）；
  根 npm run check 与 test:all:workspace 留给发布前/CI，不跑；docs:check + ui:audit:check 必跑。
- 工程教训（前批实战沉淀，违者即自伤）：
  a) git：用户 untracked 资产在册时禁用 git add -A / add .——一律显式 git add <路径>；
     新目录提交后核对 git status 确认无遗漏；
  b) 门禁退出码：禁 npm run <gate> 2>&1 | tail 接 &&（管道吞 exit 码）——判据类命令用 echo "exit=$?" 或独立执行；
  c) python 内联改 canonical：前插必须「先读完再开 'w'」，禁 truncate-then-read（曾截断 roadmap/handoff）；
  d) dev-verify flow 顶层禁 env 固化（BLOCK-375 棘轮）——用函数化调用时读取；
  e) Write 产出脚本先 node --check；eslint 新增 error 修根因（own-enumerable 查找沿 BLOCK-456 先例），
     warnings 分域只减；knip 新增键定性留痕后 --update；code-size 基线随批 --write 重打；
  f) 单源 JSON（docs/post-k7-readings-single-source.json）由 scripts/post-k7-readings-generate.mjs 重生成，
     登记 impact-map/registry 后必重跑，否则 L0-8 单源测试必红。

## 5. 自动推进触发条件与依赖关系
| 步骤 | 前置触发（全绿/合法终态才进下一步） | 依赖真源（缺则 §7 external-blocked） | 产出 work-package |
|---|---|---|---|
| S1 P2 IA/高频路径 | §1 启动硬门全过 | App.tsx、pages/、resources/design-context/ | 新 BLOCK（P2） |
| S2 P3 视觉一致性 | S1 completed | design-charter.md、theme-token-contract.test.ts | 新 BLOCK（P3） |
| S3 P4 响应式/a11y | S2 completed | nso-w3-a11y.test.tsx、ui-design-a11y.test.mjs | 新 BLOCK（P4） |
| S4 P5 性能/可信态 | S3 completed | BLOCK-154/466 边界、loading/empty/error 态组件 | 新 BLOCK（P5） |
| S5 P6 Skill v1.1 | S4 completed | resources/skills/design-brief/、petri-ui-design/SKILL.md | 新 BLOCK（P6） |
| S6 P7 非观感准备 | S5 completed；只整理清单与证据索引 | UI-706/707/709/710、E 类 22 条、本批新 UI 面 | 治理批（非观感） |
| S7 Polyfork 只读收集 | S6 completed；材料齐即停、不接入 | 官方条款/许可页（只读抓取） | 治理批（证据） |
触发语义：每步「完成」= §6 判据全满足 + 六件套回写 + commit/push 成功；external-blocked 亦视为合法终态可推进下一步（如实判档）。
依赖语义：前一步未收口不得开下一步；依赖真源缺失按 §7 降级，不臆造数据、不跳过门禁。

## 6. 执行序列（逐步闭环，前一步收口才进下一步；每步均先立项三件套=plan+registry+AUDIT-LOG）
S1 C-53 P2 IA 与高频路径（UI 面观感留槽）：立项 → HK-01 红绿（IA 映射消费契约：路由存在/无死链/
  高频路径可达）→ 机械盘点 App.tsx/pages/ → 产 resources/design-context/ia-map.json（沿 P1 先例）+
  最小消费测试 → petri-css-theme/styles 门禁 → 台账登记（观感留槽）→ 收口。
  判据：ia-map 可被消费测试锚定 + 路由数与 App.tsx 现读一致（可复算）；观感项 in_progress 零代签。
S2 C-53 P3 视觉一致性（观感留槽）：立项 → HK-01 红绿（token 落地机械扫描：禁 slate 字面量/海军蓝阶梯/
  禁零定义/颜色预算 ≤8）→ 扩展 theme-token-contract 或新增静态扫描器 → 违规红或入册 → 收口。
  判据：新扫描契约红→绿；零新增违规或违规已入 eslint-suppressions 账；petri-css-theme 门禁绿；视觉观感留槽。
S3 C-53 P4 响应式与可访问性（a11y 机械项可验、视觉观感留槽）：立项 → HK-01 红绿（键盘/焦点/ARIA/
  对比度/触摸目标/断点存在性）→ 扩展既有 a11y 契约 → types/lint 绿 → 收口。
  判据：a11y 契约红→绿 + 既有 nso-w3-a11y/ui-design-a11y 零回归；视觉美观 pending_human_eye 留槽。
S4 C-53 P5 性能与可信状态（观感留槽）：立项 → HK-01 红绿（加载/空/错误/流式可信态状态机：
  partial spec 不闪烁/首屏占位/断线续传兼容）→ 状态机契约 → BLOCK-154 memo 边界绿 → 收口。
  判据：状态机契约红→绿 + memo 边界绿；动画观感 pending_human_eye 留槽。
S5 C-53 P6 产品 Skill v1.1（无观感面）：立项 → 读 resources/skills/design-brief/README.md 现结构 →
  HK-01 红绿（Skill 契约：消费 design-context + ia-map + a11y 约束）→ 升级 → skills:check 绿 → 收口。
  判据：Skill 契约红→绿 + skills:check 绿；零新增产品依赖；发现桥 symlink 零退化。
S6 C-53 P7 非观感准备（治理批，签字留用户）：整理人眼收口清单（UI-706/707/709/710 + E 类 22 条 +
  本批新 UI 面）+ 证据索引（每条对应 acceptance 路径）；不改任何观感状态为 verified → docs:check → 收口。
  判据：清单齐 + 每项保持 in_progress + 签字槽留空；零代签。
S7 Polyfork 授权材料只读收集（R6 附线，材料齐即停）：只读抓取官方条款/许可页 →
  逐条摘录原文+链接存 acceptance/polyfork-license-materials/ → 零接入代码/零整包安装 → 收口。
  判据：材料清单落盘、每条原文+链接可核；授权边界结论与接入决策归用户；抓取受阻按 §7 external-blocked。

## 7. 异常处理与降级策略（失败诚实，不伪造通过）
- 红绿失败：HK-01 红项逐条归因；能修根因则修后复跑，不能修则如实标红并说明归属，不掩盖。
- 真源/环境缺失（App.tsx 改面、a11y 测试文件迁移、9223 后端未起、官方页抓取受阻）：
  标 external-blocked + 写归因（缺什么/试过什么/为何不可得）+ 保留契约级证据，推进下一步，不臆造数据。
- 观感项：pending_human_eye 保持 in_progress，签字槽留空；只完成非观感部分。
- C 类/红线 2：安全/破坏/数据丢失/用户资产/新裁决点（Polyfork 接入结论、design-charter 冻结项、
  产品级新依赖、G1+）——立即停止，最终报告列「待用户」，不为推进绕过。
- perf 继承抖动：quality:perf packaged_start 边界噪声归属既有基线，closeout 以 --skip=quality:perf
  如实标注 SKIPPED（不算 PASS），不重打基线；plan 留归属注记。
- push 失败（凭据/网络）：如实标 external-blocked，本地 commit 保留，不重写历史、不强推。
- 冲突/漂移：canonical 文档冲突以 Git/SQLite/Artifact/Acceptance 证据为准，先降级冲突声明再修复入口。

## 8. 输出格式与进度汇报方式
每步收口用固定块（新 Agent 每完成一步即输出，便于外部观测进度）：
  【步骤收口 · S<n> <阶段名>】
  - 状态：completed/CLOSED | external-blocked | 红线停下
  - 工作包：<BLOCK-id>（plan 路径）
  - 判据：逐条 G1/G2/… ✅ / ❌(归因) / SKIP(原因)
  - 证据：acceptance/<step>/ 文件清单
  - 观感槽：<列出项> → in_progress（pending_human_eye，零代签）
  - 门禁：定向测试 x/x、closeout PASS/SKIP 明细、docs:check、ui:audit:check
  - 六件套：plan / blueprint / roadmap / handoff / AUDIT-LOG / registry（各 completed 回写）
  - commit/push：<hash> / 同步 0-0 或 external-blocked
  - 下一步：S<n+1> 触发条件是否满足
最终报告（全部步骤收口/合法终态后）：
  ① 各步骤结果表；② external-blocked 清单；③ 观感待签字清单（如实）；
  ④ 用户动作清单（P7 人眼 / Polyfork 授权结论 / D5 等）；⑤ 剩余既有红；
  ⑥ 下一步提示（Jev 单一建议 + 母纲波次 + 蓝图进展，Jev cloud 已修可直接用 npm run next:suggest -- --supply=cloud）。

## 9. 每步完成判据（未满足不得宣布该步完成，不跳步）
- 任务卡步骤全执行或有明确 external-blocked 归因；
- 定向测试 + 专项门绿（红项逐条归因，SKIP 注明原因不算 PASS）；
- 证据落 acceptance/<step>/；
- 六件套 canonical 回写完成（registry status=completed/phase=CLOSED）；
- 观感项保持 in_progress 零代签；
- commit + push 成功或 external-blocked 如实报告。

## 10. 收尾
1. 全部步骤收口/合法终态后，核对 charter §6 完整性自检（npm run state + registry 复算 + docs:check）。
2. 更新 C-54 投影状态、roadmap 指针、handoff、AUDIT-LOG；commit + push
   （push 需凭据且无预置则标 external-blocked 如实报告）。
3. 收尾重跑 npm run decision:session 取本轮 Jev 增量计数（禁复用上一轮数字），
   收尾声明前跑 npm run output:judge（ESCALATE 如实记录）。
4. 输出固定下一步提示：Jev 单一建议（含 confidence、具体范围、体量/类型）+ 母纲波次顺序
   （P4-REM 最后、Q4b 单列）+ 蓝图/全局计划进展（Q-MATRIX 计数与 §6.5 剩余、竞争力纲/成熟度蓝图、
   Result Studio、UI 台账、active 工作包）。建议是 advice，未获发令不得开工。

## 11. 结束条件
S1–S7 全部收口或明确 external-blocked、六件套回写完成、最终报告输出、工作区无新未决 WIP
（untracked 用户资产除外），即完成。观感签字槽与 C 类停止项如实列为「待用户」，不冒充完成。
```

## §3 配套说明（非提示词正文）

- **授权来源**：§2 内 §2 的 R8–R15 预置裁决源自用户 2026-11-18「为下一阶段的工作设计一个无人值守（全自动）执行的详细提示词」——把本提示词交给新 Agent 即视为对该范围的发令；超出的新裁决点（Polyfork 接入结论、design-charter 冻结项、产品级新依赖、G1+）一律红线 2 停。
- **与上一批的关系**：上一批（`next-phase-e2e-prompt-2026-11-18.md`，BLOCK-465~469）已全执行完毕；本文件是其后继批次，承接 Jev 单一建议 C-53-P2（0.58）与 C-53 权威阶段定义。
- **范围纪律**：本提示词只覆盖 C-53 P2–P7 + Polyfork 只读收集；C-53 P0/P1 已完成（BLOCK-465），不重复开发；候选池（C-50/C-52 余项/C-45/C-47/MIGRATION-IDEMPOTENT/C-55）仅登记不开工。
- **用户动作清单（提示词执行后仍需人）**：①C-53 P7 人眼收口签字 + UI-706/707/709/710 + E 类 22 条观感签字；②Polyfork 授权边界结论与接入决策；③post-h9 D5 原件处置。
- **不可独立运行的例外**：若新 Agent 无法加载 skills 或 Jev cloud 不可达，按 §1/§7 降级（cloud 不可用不阻断确定性工作；skills 不可加载则停止并报告，不臆造治理流程）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
