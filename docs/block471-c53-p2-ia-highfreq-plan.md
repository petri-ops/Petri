---
capability: block471-c53-p2-ia-highfreq
status: completed
kind: work-package
truthDomain: block471-c53-p2-ia-highfreq
entrypoint: docs/README.md
goal: C-53 UI-DESIGN-QUALITY 的 P2（IA 与高频路径首片）——从 App.tsx/pages 机械盘点信息架构与高频路径，产模型可读 IA 映射（沿 resources/design-context 先例，落 ia-map.json）+ 消费测试锚定；纯资源/文档面，零 UI 运行时写面、零观感代签
acceptance:
  - HK-01 红绿先行：IA 映射消费测试先红（文件缺席/路由不符/死链/高频路径不可达）后绿；含篡改负测 fail-closed
  - IA 映射可复算：collectIaMap(appSource) 纯函数从 App.tsx 现读路由（主窗 + 窗口面 + 重定向），落盘 ia-map.json 的路由集合与 App.tsx 现读完全一致；--check 重算与落盘一致（忽略易变字段）
  - 高频路径 3–5 条可达：每条路径的每一跳解析到在册路由或合法重定向，无死链；路径定义与现读拓扑一致，不臆造页面
  - 观感零代签：本包无 pending_human_eye 面（纯资源 JSON + 脚本 + 测试），UI 台账观感项保持 in_progress
  - 零新增产品依赖、零 UI 运行时写面；closeout 定向门禁全绿 + impact-map 登记 + 六件套回写
---

# BLOCK-471 · C-53 P2 IA 与高频路径（completed / P2-LAUNCH→CLOSED）

> **发令**：用户 2026-11-18 复制「可复制启动提示词」发令「开始 C-53 P2」——承接批2提示词 `docs/next-phase-e2e-prompt-2026-11-18-b2.md` S1 / R9。
> **从属**：`docs/petri-master-charter.md` + AUDIT-LOG C-53 权威阶段（P0 基线冻结→P1 上下文包硬化→P2 IA 与高频路径→…→P7 人眼收口）+ BLOCK-465（P0/P1 已完成）。

## 1. 范围（scope）

1. **IA 映射机械盘点**：新增 `scripts/c53-ia-map.mjs`——纯函数 `collectIaMap(appSource)` 从 `frontend/src/App.tsx` 现读解析两棵树：
   - 主窗路由（`/`、`/projects`、`/extensions`、`/skills`→重定向、`/plugins`→重定向、`/settings`、`/knowledge`、`/review`、`/project/:projectId/results`→重定向、`/project/:projectId/*`、`*` 兜底）；
   - 窗口面路由（`/window/terminal/:sessionId`、`/window/command-center`、`/window/side-chat`、`/window/rail`、`*` 兜底）；
   - 每条带 `{path, component|redirect, surface, sourceLine}`，整体带 `sourceCommit`/`generatedAt`。落盘 `resources/design-context/ia-map.json`。
2. **高频路径定义**：在 IA 映射内定义 3–5 条高频路径（从现读拓扑推导，不臆造页面），每条 `{id, name, steps[]}`，每步解析到在册路由或合法重定向。候选（待现读确认后定稿）：首问→工作区、项目→工作区、工作区→评审、扩展/技能、知识→工作区。
3. **消费测试**：`test/c53-ia-map.test.mjs`——重算 collector 与落盘逐路由比对；无死链断言（所有重定向目标解析到在册路由）；高频路径可达断言；篡改负测（改路径/改哈希/插死链）fail-closed；HK-01 红→绿留痕。
4. **manifest 同步**：`resources/design-context/manifest.json` 的 files 追加 ia-map.json + sha256（沿 P1 先例）。

## 2. 非范围（exclusions）

- UI 运行时写面（组件/CSS/路由代码零改）、观感签字（pending_human_eye 零代签）、design-charter 冻结档位/预算变更；
- C-53 P3–P7（视觉一致性/响应式 a11y/性能可信态/Skill v1.1/人眼收口）；
- 新产品 Skill（design-brief 已交付，本包只产模型可读 IA 输入）；用户 untracked 资产零触碰；G1+。

## 3. 验收门禁与证据

- **G1 红绿**：`node --test test/c53-ia-map.test.mjs` 先红（实现前）后绿。
- **G2 可复算**：`node scripts/c53-ia-map.mjs --check` 重算通过；ia-map 路由与 App.tsx 现读一致；manifest sha256 一致。
- **G3 零回归**：`test/c53-design-context-pack.test.mjs`（P1 包）零回归；petri-css-theme/styles 门禁（本包无样式改动，报告级）；docs:check/ui:audit:check 绿；零新增依赖。
- **G4 治理**：closeout 定向门 + impact-map 登记 + 六件套回写。

## 4. 完成语义

G1–G4 全绿或明确 external-blocked + 六件套回写 + 证据落 `acceptance/block471-c53-p2-ia/`。本包无观感面（资源 JSON+脚本+测试均非用户 UI 写面），如实登记；不冒充任何 pending_human_eye 项 verified。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 5. 收口记录（2026-11-18）

HK-01 红→绿 7/7（模块缺席 ERR_MODULE_NOT_FOUND → 7/7）；--check PASS（routes=12 redirects=4 hfp=5）；P1 包 8/8 零回归；lint ledger 2441 不动；docs:check(625)/ui:audit:check 绿。证据=acceptance/block471-c53-p2-ia/。零 UI 写面/观感/发令。C-53 P3-P7 待后续发令。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 收口门禁归属（2026-11-18）

closeout 全绿（perf SKIPPED）：quality:perf packaged_start 边界抖动（G0 噪声，noiseSources 在册）——本批零 perf 面改动（纯资源/脚本/测试），归属既有基线，不属本包，不重打基线掩盖。

G0 开发期常态 · 不外推 packaged/Provider/GA。
