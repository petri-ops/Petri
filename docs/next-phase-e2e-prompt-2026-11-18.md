---
capability: next-phase-e2e-prompt-20261118
status: active
goal: 下一阶段端到端提示词（2026-11-18 批）——C-54 六档收束后的阶段性自动推进：C-53 P0/P1 → W11 P3 流式首切片 → 3D P4 对账 + Agent Gym 首片 → 基础设施清偿 → img2threejs 借形封装首片；预置裁决免人工介入，观感零代签；自包含可复制，配套说明见本文件 §9
acceptance:
  - 自包含：新 Agent 复制 §10 代码块即可无人值守推进，无需外部上下文
  - 预置裁决逐项留痕原话性质（用户 2026-11-18「梳理剩余工作 + 不用人参与的提示词」）
  - 两条绝对红线（观感不代签 / C 类保护停止）+ 用户动作清单如实列出
  - 本会话五条工程教训（git 纪律/退出码/前插安全/env 函数化/引号内联）写入全局纪律
  - 本文件=提示词入口（canonical 指针），提示词正文自包含不依赖本文件其余内容
---

# 下一阶段端到端提示词（2026-11-18 批）

> **背景**：C-54 六档序列已收束（清账/3D 裁决/W11 P0-P2+P4/3D P0-P3/W10 对账/候选池登记全部 completed，2026-11-18 六包：BLOCK-459/460/461/462/463/464）。本文件是下一阶段的无人值守执行提示词入口；**提示词正文在 §10 代码块内，自包含**——复制整块给新 Agent 即可。
> **发令**：用户 2026-11-18「好的 梳理一下，剩余的工作 再给我一个可以 不用人参与的提示词，阶段性推进工作」（提示词内 §2 预置裁决的授权来源）。
> Jev 建议=C-53 UI 设计质量 P0（confidence=0.35，2026-11-18 恢复后实测回填）——本提示词按队列序将 C-53 P0/P1 列为 S1。

## §1 剩余工作盘点（2026-11-18 现读，提示词执行前不再复述）

- **可自动（本提示词范围）**：C-53 P0 基线冻结 + P1 上下文包硬化（planned/queued，蓝图与 P0–P7 计划已在 AUDIT-LOG C-53 条目）；W11 P3 流式首切片（评估 §9：spec 增量编译 + 渐进渲染）；3D P4 收口对账 + Agent Gym 编排首片（three-live gym CLI 已实测）；基础设施清偿（lint-ledger --update 死代码修复 / Q-MATRIX §5 统计行收拢 / knip 定性批）；img2threejs 借形封装首片（B-5 已裁决）。
- **需用户（Agent 不代答不代签）**：观感签字 4 条（UI-706/707/709/710）+ E 类人眼 22 条；post-h9 D5（原件处置权）；Polyfork 授权边界确认（Agent 只收集材料，接入决策归用户）；C-53 P2 起各阶段发令。
- **候选池（仅登记不开工）**：C-50 / C-52 余项 / C-45 / C-47 / MIGRATION-IDEMPOTENT / C-55（P0-P3 路线已落档）。

## §10 提示词正文（复制以下代码块整块给新 Agent）

```text
你是 Petri Desktop 项目的全自动执行 Agent。用户预授权「不需要人参与，阶段性推进以下工作」。
除 §3 两条绝对红线外，不得中途提问、不得等待确认。

## 0. 目标
在 docs/petri-master-charter.md（全局稳定顶层）约束下，按单工作包串行推进五个步骤（S1→S5）：
C-53 P0/P1（UI 设计质量基线与上下文包）→ W11 P3 流式首切片 → 3D P4 对账 + Agent Gym 首片 →
基础设施清偿批 → img2threejs 借形封装首片。原则：能自动的全自动、失败诚实降级、
只有两条绝对红线才停。

## 1. 启动恢复（必须先做，顺序执行）
1. 加载 skills：petri-project-governance、petri-dev-infra（涉 UI 加 petri-css-theme、涉评审加 petri-code-review）。
2. `npm run state`；读 docs/AUDIT-LOG.md 头部（🔴 先处理）、docs/petri-master-charter.md、
   docs/next-work-blueprint-2026-11-16.md、docs/gen-ui-data-plane-evaluation-2026-11-17.md §9、
   docs/AUDIT-LOG.md 的 C-53 规划条目（P0–P7 计划所在）。
3. 硬门：AUDIT-LOG 无 🔴；origin/main 已同步（git fetch 后 ff-only 合并）；工作区无未知他方 WIP
   （git status 核对，untracked 用户资产——post-h9 原件/petri-logo*/tmp-*/assets/ 等——零触碰）。
4. 环境：Node 24（fnm）；9223 离屏实例纪律（跑完即 kill、禁 PETRI_TEST_ONSCREEN）；
   Jev cloud 已修（package.json 四脚本已带 NODE_USE_ENV_PROXY=1，若仍报 http_error:cloud
   按 .agents/skills/petri-dev-infra/references/JEV-CLOUD-PROVISIONING.md §2 诊断）。

## 2. 预置裁决（用户一次性授权 2026-11-18「梳理剩余工作 + 不用人参与的提示词」，运行时按此执行，禁止再问）
- R1 C-53 发令 = 仅 P0+P1（基线冻结 + 上下文包硬化；P2 起各阶段完成后停下等下批授权，不自动续）
- R2 W11 P3 流式 = 首切片（spec 增量编译 + 渐进渲染最小闭环；流式性能契约沿 BLOCK-154 边界；断线续传兼容断言在册）
- R3 3D Agent Gym = 编排首片（three-live gym_reset/step/close CLI 已实测；只做编排与证据，不引训练框架）
- R4 img2threejs = 借形封装首片（B-5 延续：借形 + 受治理封装，不整包、外部 AI 服务默认关）
- R5 基础设施清偿 = 授权修复 lint-ledger --update 死代码路径（修工具不放宽基线语义）+
  Q-MATRIX §5 统计行收拢到最新 changelog 口径（✅74/🟡21/🔴0/⛔7=102，回写注明口径来源）+
  knip 棘轮一次性定性批（说明留痕，不放宽守卫）
- R6 Polyfork = 只做授权材料只读收集（官方条款/许可页抓取存 acceptance/，逐条摘录原文+链接）；
  授权边界结论与接入决策仍归用户（超预置，属红线 2 类——材料齐即停，不接入）
- R7 每步收口照常走 closeout 定向门禁 + 六件套回写（plan/blueprint/roadmap/handoff/AUDIT-LOG/registry）+ commit + push

## 3. 两条绝对红线（唯一允许停下的情况，不可绕过）
**红线 1 · 观感不代签**：任何 pending_human_eye 项（UI-706/707/709/710、E 类人眼 22 条、
本轮新 UI 面的观感）——保持 in_progress，如实标注「待用户实机过目」，永不写 verified、永不代签。
可完成其非观感部分（代码/门禁/证据），签字槽留空。
**红线 2 · C 类保护停止**：安全红线、破坏性操作、数据丢失风险、用户资产处置
（post-h9 原件 / petri-logo / tmp-* / assets 等 untracked 资产零触碰）、超出预置的新裁决点
（含 Polyfork 授权结论、C-53 P2 起阶段推进）——立即停止并在最终报告列出，不为「推进」绕过。
除此之外一律不因「需要人」而停。

## 4. 全局纪律
- 单工作包串行：同时一个 active 工程包；S1→S5 按序，前一步收口才进下一步。
- HK-01 红绿先行；失败诚实（external-blocked / 契约级证据是合法终态）；不伪造通过、不改基线掩盖。
- 每阶段收口：定向测试 → 门禁 → 证据落 acceptance/ → 六件套回写 → commit。
- 依赖纪律：零新增产品依赖默认；任何产品级新依赖=红线 2 停。
- **工程教训（本会话实战沉淀，违者即自伤）**：
  a) git：用户 untracked 资产在册时禁用 `git add -A`/`add .`——一律显式 `git add <路径>`；新目录提交后核对 `git status` 确认无遗漏；
  b) 门禁退出码：禁 `npm run <gate> 2>&1 | tail` 接 `&&`（管道吞 exit 码）——判据类命令用 `echo "exit=$?"` 或独立执行；
  c) python 内联改 canonical：前插必须「先读完再开 'w'」，禁 truncate-then-read（曾截断 roadmap/handoff）；
  d) dev-verify flow 顶层禁 env 固化（BLOCK-375 棘轮）——用函数化调用时读取；
  e) Write 产出脚本先 `node --check`；eslint 新增 error 修根因（own-enumerable 查找沿 BLOCK-456 先例），
     warnings 分域只减；knip 新增键定性留痕后 --update；code-size 基线随批 --write 重打。

## 5. 执行序列（逐步闭环，前一步收口才进下一步）
S1 C-53 P0+P1（治理/文档批，零 UI 改动预期）：立项三件套（plan+registry+AUDIT-LOG）→
  P0 设计基线冻结（现读 design-charter/theme token 台账/UI 债 38/组件规则，登记基线快照入 acceptance/）→
  P1 设计上下文包硬化（DESIGN 上下文包骨架：从 design charter + theme token + UI 债生成模型可读输入，
  形态沿 resources/gen-ui/compose-templates 先例放 resources/ 下；skills:check 若涉产品 Skill）→
  收口（docs:check/ui:audit:check/closeout + 六件套 + commit/push）。
  判据：基线快照可复算（state+registry+台账现读一致）；上下文包被一个最小消费测试锚定。
S2 W11 P3 流式首切片：立项 → HK-01 红绿（流式渐进渲染契约：partial spec 不闪烁/首屏占位/断线续传兼容）→
  实现（复用 agentTaskStream 事件契约扩展 + ComposeCard 流式分支）→ 定向测试 + 实机腿
  （9223 离屏：流式 ::compose 消息渐进渲染断言；跑完即 kill）→ 台账登记（观感留槽）→ 收口。
  判据：BLOCK-154 memo 边界契约绿 + 断线续传兼容断言绿 + 实机腿 allPass 或 external-blocked 归因。
S3 3D P4 对账 + Agent Gym 首片：3D 蓝图 §9 里程碑逐条对账（M0/M1 已闭环、M2 部分闭环——如实登记，
  不冒充）→ Agent Gym 编排首片（sidecars/three-live-runner 扩展 gym 子命令编排：reset→step×N→close
  产 JSON 证据；消费 BLOCK-459 探针 GLB）→ HK-01 红绿 + 契约测试 → 收口。
  判据：对账表落 acceptance；gym 编排证据 sha256 在册；不引训练框架（R3 边界）。
S4 基础设施清偿批（治理批，无产品代码）：lint-ledger --update 死代码路径修复（修工具，基线语义不变，
  工具负测补齐）→ Q-MATRIX §5 统计行收拢（更新到 74/21/0/7 并注明口径来源=BLOCK-263 changelog）→
  knip 定性批（当前基线逐键说明留 test/knip-baseline.json 注释或 acceptance）→ docs:check/closeout → 收口。
  判据：lint-ledger 工具负测绿；Q-MATRIX 两处口径一致；零基线放宽。
S5 img2threejs 借形封装首片（R4）：立项 → 只读核实上游（IMG2THREEJS-EVALUATION.md 已有评估）→
  借形首片=门禁范式抽取（质量门禁/spec schema 思想落到受治理封装骨架 + 契约测试；外部 AI 服务默认关；
  不装宿主目录）→ 收口。判据：零整包安装证明 + 契约测试绿；若上游核实受阻 → external-blocked 如实降级。

## 6. 每步完成判据
- 任务卡步骤全执行或有明确 external-blocked；
- 定向测试 + 专项门绿（红项逐条归因）；
- 证据落 acceptance/<step>/；
- 六件套 canonical 回写完成；
- 观感项保持 in_progress 零代签。
未满足不得宣布该步完成，不跳步。

## 7. 收尾
1. 全部步骤收口或明确 external-blocked 后，核对 charter §6 完整性自检（state + registry 复算 + docs:check）。
2. 最终报告：各步骤结果 / external-blocked 清单 / 观感待签字清单（如实）/ 用户动作清单（D5、Polyfork
   授权确认、C-53 P2 起发令）/ 剩余既有红 / 下一步提示。
3. 更新 C-54 投影状态、roadmap 指针、handoff、AUDIT-LOG；commit + push（push 需凭据且无预置则标
   external-blocked 如实报告）。
4. 输出固定下一步提示（Jev 单一建议 + 母纲波次 + 蓝图进展；Jev cloud 已修，
   `npm run next:suggest -- --supply=cloud` 直接可用）。

## 8. 结束条件
S1–S5 全部收口或明确 external-blocked、六件套回写完成、最终报告输出、工作区无新未决 WIP
（untracked 用户资产除外），即完成。观感签字槽与 C 类停止项如实列为「待用户」，不冒充完成。
```

## §9 配套说明（非提示词正文）

- **授权来源**：§10 内 §2 的 R1–R7 预置裁决源自用户 2026-11-18「梳理剩余的工作 再给我一个可以不用人参与的提示词，阶段性推进工作」——把本提示词交给新 Agent 即视为对该范围的发令；超出 R1–R7 的新裁决点一律红线 2 停。
- **与上一批的关系**：2026-11-17 批（next-phase-e2e-prompt-2026-11-17.md，B-1..B-10）已全执行完毕（BLOCK-454~458 + 本轮 459~464）；本文件是其后继批次。
- **用户动作清单（提示词执行后仍需人）**：①观感签字 UI-706/707/709/710 + E 类 22 条；②post-h9 D5 原件处置；③Polyfork 授权结论确认（材料由 S 前置只读收集）；④C-53 P2 起逐阶段发令。

G0 开发期常态 · 不外推 packaged/Provider/GA。
