---
capability: block465-c53-design-baseline-context-pack
status: completed
kind: work-package
truthDomain: block465-c53-design-baseline-context-pack
entrypoint: docs/README.md
goal: C-53 UI-DESIGN-QUALITY 的 S1（R1 = 仅 P0+P1）——P0 设计基线冻结（从 design-charter / theme token 契约 / UI 债 38 / 组件规则机械复算，快照可复算）+ P1 设计上下文包硬化（从同一批真源生成模型可读输入，沿 resources/gen-ui/compose-templates 先例放 resources/ 下，被最小消费测试锚定）
acceptance:
  - HK-01 红绿先行：上下文包消费测试先红（文件缺席/读数不符）后绿；含篡改负测（fail-closed）
  - P0 基线快照可复算：collectDesignBaseline(root) 纯函数现读 design-charter.md + theme-token-contract.test.ts 棘轮 + ui-ledger-triage.json(债 38) + 组件规则 + registry/AUDIT-LOG；`--check` 重算与落盘一致（忽略生成时间/commit 易变字段）
  - P1 上下文包在 resources/design-context/ 落 manifest.json + design-context.json；manifest sha256 与文件内容一致；消费测试断言关键读数与现真源一致
  - 零新增产品依赖、零 UI 运行时写面、零观感签字（本包无 pending_human_eye 面）
  - closeout 定向门禁全绿（--report skills:check 报告级，不新增产品 Skill）+ impact-map 登记
---

# BLOCK-465 · C-53 S1 设计基线冻结 + 上下文包硬化（completed / P0-LAUNCH→CLOSED）

> **发令**：用户 2026-11-18「梳理剩余工作 + 不用人参与的提示词」预置裁决 R1 = C-53 发令仅 P0+P1（P2 起各阶段完成后停下等下批授权）。本包是五步串行的 S1。
> **从属**：`docs/petri-master-charter.md`（全局稳定顶层）+ AUDIT-LOG C-53 规划条目（`P0 基线冻结→P1 上下文包硬化→P2..P7`）+ `docs/next-phase-e2e-prompt-2026-11-18.md` §5 S1。
> **ID 取舍**：C-53 原条目 plan=AUDIT-LOG 行（候选池规划，非可执行 plan 文件）；本包有独立可收口验收边界（快照+包+测试），按 governance「distinct acceptance boundary → 新稳定 ID」立 BLOCK-465，C-53 条目保留为母规划锚，不另立第二 active canonical。

## 1. 范围（scope）

1. **P0 设计基线冻结**：新增 `scripts/c53-design-baseline.mjs`——纯函数 `collectDesignBaseline(root)` 机械复算四类真源 + 状态面：
   - design-charter.md：字号 6 档 / 色彩预算（中性:强调 ≥10:1、accent ≤130、每视图 ≤8）/ 线条三语义 / 动效（150/200/300ms + 2 ease）/ 控件五件套 / §7 三条棘轮终态；
   - theme token 契约：`frontend/src/styles/theme-token-contract.test.ts` 断言组在场（三棘轮 + 存在性 + ::selection 唯一 + 红证据自检）；
   - UI 债：`acceptance/block-332/ui-ledger-triage.json` 机械口径（sections 503 / uniqueIds 494 / debt 38 = live-missing 15 + blocked 23 / verified 453 / closed 12），与 `scripts/lib/post-h9-k3-experience.mjs` DEBT_CEILING 交叉一致；
   - 组件规则：design-charter §6 + `frontend/src/components/ui/controls/` 现读文件；
   - 状态面：DOC-REGISTRY 文档计数 + AUDIT-LOG 🔴/🟢 未决数（现读=0）。
   每条读数带 `{value, source, command, capturedAt}`，整体带 sourceCommit；落盘 `acceptance/block465-c53-p0p1/design-baseline.json`。`--check` 模式只重算不写盘。
2. **P1 设计上下文包硬化**：同一 collector 派生模型可读输入，落 `resources/design-context/`：`design-context.json`（字号/色彩/线条/动效/控件/棘轮/UI 债/人眼边界，结构化）+ `manifest.json`（schemaVersion/生成器/sourceCommit/文件 sha256）。沿 compose-templates 先例：纯资源 JSON + 测试锚，非产品 Skill、非运行时代码。
3. **消费测试**：`test/c53-design-context-pack.test.mjs`——重算 collector 与落盘包逐读数比对；manifest sha256 校验；篡改负测（改读数/改哈希）fail-closed；HK-01 红→绿留痕。

## 2. 非范围（exclusions）

- C-53 P2–P7（IA/高频路径、视觉一致性、响应式与可访问性、性能与可信状态、产品 Skill v1.1、人眼收口）——R1 明确停下等下批授权；
- 新产品 Skill（C-52 已交付 `resources/skills/design-brief` 与 `.agents/skills/petri-ui-design`，本包只硬化其下游可读输入，不并造第三套）；
- UI 运行时写面 / 观感签字（pending_human_eye 零代签）；design-charter 档位/预算变更（冻结，改需用户裁决）；
- 用户 untracked 资产（post-h9 原件 / petri-logo / tmp-* / assets / model3d 原件等）零触碰；G1+。

## 3. 验收门禁与证据

- **G1 红绿**：`node --test test/c53-design-context-pack.test.mjs` 先红（实现前）后绿。
- **G2 可复算**：`node scripts/c53-design-baseline.mjs --check` 重算通过；快照 JSON 现读与 canonical 一致。
- **G3 零回归**：`ui:audit:check`、`docs:check`、`skills:check`（报告级）绿；零新增依赖。
- **G4 治理**：closeout 定向门 + impact-map 登记 + 六件套回写。

## 4. 完成语义

G1–G4 全绿或明确 external-blocked + 六件套回写（plan/blueprint/roadmap/handoff/AUDIT-LOG/registry）+ acceptance 证据落盘。本包无观感面（资源 JSON + 脚本 + 测试均非用户 UI 写面），如实登记；不冒充任何 pending_human_eye 项 verified。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 5. 收口记录（2026-11-18）

G1 红→绿 8/8（HK-01 红 1 → 绿 8）；G2 --check exit 0；G3 theme-token 19/19 + docs/ui-audit 绿；G4 closeout 见 AUDIT-LOG。证据=acceptance/block465-c53-p0p1/。零观感面。C-53 P2-P7 按 R1 停下等授权。

G0 开发期常态 · 不外推 packaged/Provider/GA。
