---
capability: block475-c53-p6-skill-contract
status: completed
kind: work-package
truthDomain: block475-c53-p6-skill-contract
entrypoint: docs/README.md
goal: C-53 UI-DESIGN-QUALITY 的 P6（产品 Skill v1.1）——沿 P1–P5 先例把 design-brief 产品 Skill 升级到 v1.1.0，使其契约显式消费 P1 上下文包 + P2 IA 映射 + P4 a11y 约束（并登记 P3/P5 读数）；新增独立静态扫描器从真源机械复算六组读数 + 模型可读 skill-contract.json（生成器维护 manifest sha）+ 消费测试锚定；对齐 .agents/skills/petri-ui-design/SKILL.md 走发现桥 symlink。零新增产品依赖、零观感代签、零发现桥退化
acceptance:
  - HK-01 红绿先行：消费测试先红（扫描器/契约缺席）后绿；含篡改负测 fail-closed
  - Skill 契约可复算：collectSkillContract(root) 从 canonical 真源机械派生，落 resources/design-context/skill-contract.json；--check 重算与落盘逐读数一致（忽略易变字段）；生成器自身维护 manifest sha256
  - design-context 消费：design-brief README.md + prompts/system.md 现读引用五件套（design-context/ia-map/visual-consistency/responsive-a11y/performance-trust.json）+ manifest.json；缺失必红
  - IA 映射消费：引用 ia-map / 路由 / 高频路径 / 重定向契约关键词；缺失必红
  - a11y 约束消费：引用键盘/焦点/ARIA/对比度/触摸目标/断点 + responsive-a11y.json；缺失必红
  - Skill 版本契约：design-brief skill.json version=1.1.0 且 resources/skills/manifest.json 登记 version 一致；capabilities 增补消费类目；漂移必红
  - 发现桥对齐：.agents/skills/petri-ui-design/SKILL.md 治理真源纳入 design-context 包 + ia-map + a11y 契约；.codebuddy/skills/petri-ui-design symlink 真链在场且零退化；缺任一必红
  - 观感零代签：pending_human_eye 保持 in_progress，签字槽留用户；本包零 UI 运行时写面
  - 零新增产品依赖；skills:check 绿（13 内置）+ post-s7-skill-integrity --check 绿；P0–P5 契约零回归；closeout 定向门禁 + impact-map 登记 + 六件套回写
---

# BLOCK-475 · C-53 P6 产品 Skill v1.1（completed / P6-LAUNCH→CLOSED）

> **发令**：用户 2026-11-18 发令「开始 C-53 P6」——承接批2提示词 `docs/next-phase-e2e-prompt-2026-11-18-b2.md` S5 / R13，前序 S4（BLOCK-474 / C-53 P5）已收口。
> **从属**：`docs/petri-master-charter.md` + AUDIT-LOG C-53 权威阶段（P0 基线冻结→P1 上下文包硬化→P2 IA→P3 视觉一致性→P4 响应式 a11y→P5 性能与可信状态→P6 产品 Skill v1.1→P7 人眼收口）+ BLOCK-465/471/472/473/474 已完成。

## 1. 范围（scope）

1. **静态扫描器**：新增 `scripts/c53-skill-contract.mjs`——纯函数 `collectSkillContract(root)` 从 canonical 真源机械复算六组读数，落 `resources/design-context/skill-contract.json`（沿 P1–P5 design-context 先例，生成器自身维护 manifest sha256）：
   - **designContextConsumption**：`resources/skills/design-brief/README.md` + `prompts/system.md` 现读引用五件套 JSON 文件名（design-context / ia-map / visual-consistency / responsive-a11y / performance-trust）+ `manifest.json` + `resources/design-context/` 目录路径。
   - **iaConsumption**：引用 `ia-map` / 路由 / 高频路径 / 重定向契约关键词（P2 真源被消费）。
   - **a11yConstraints**：引用键盘 / 焦点 / ARIA / 对比度 / 触摸目标 / 断点 + `responsive-a11y.json`（P4 真源被消费）。
   - **skillVersionContract**：`design-brief/skill.json` version=1.1.0 且 `resources/skills/manifest.json` 登记 version 一致；capabilities 增补 `design-context-consumption` / `ia-map-consumption` / `a11y-constraints` 三类目。
   - **bridgeAlignment**：`.agents/skills/petri-ui-design/SKILL.md` 的 Governing sources 纳入 design-context 包 + ia-map + a11y 契约；`.codebuddy/skills/petri-ui-design` symlink 真链在场且指向 `.agents/skills/petri-ui-design`。
   - **humanEyeSlots**：观感留槽 pending_human_eye 保持 in_progress，签字槽留用户；本包零观感写面如实登记。
2. **Skill 本体升级**：`resources/skills/design-brief/README.md`（新增「设计上下文真源」段）+ `prompts/system.md`（规范锚点节补 design-context 读取顺序）+ `skill.json`（version 1.0.0→1.1.0、capabilities 增补）+ `resources/skills/manifest.json`（design-brief version/capabilities 同步 + `post-s7-skill-integrity.mjs --write` 重算 builtinSha256）。
3. **Agent skill 对齐**：`.agents/skills/petri-ui-design/SKILL.md` Governing sources 纳入 design-context 五件套 + ia-map + a11y 契约（真源改动经 symlink 自动生效，`.codebuddy` / `.claude` 发现桥零退化）。
4. **消费测试**：`test/c53-skill-contract.test.mjs`——可复算（现读 vs 落盘逐读数深等）、六组读数断言、篡改负测（引用清零/版本漂移/桥断链/结构破坏）fail-closed、P0–P5 包零回归；HK-01 红→绿留痕。

## 2. 非范围（exclusions）

- 产品运行时代码 / CSS / 组件 / 路由 / IPC / 任何 UI 写面；观感签字（pending_human_eye 零代签）；design-charter 冻结档位/预算变更；
- 改 P1–P5 真源 JSON 的语义部分（design-context.json / ia-map.json / visual-consistency.json / responsive-a11y.json / performance-trust.json 是零回归基线，只读复算）；
- 改 `theme-token-contract.test.ts`（P0 快照锚定）；新增产品 Skill 或产品级新依赖；改 skill-registry 校验逻辑；
- C-53 P7 人眼收口；用户 untracked 资产（post-h9 原件 / petri-logo* / tmp-* / assets / model3d 原件等）零触碰；G1+。

## 3. 验收门禁与证据

- **G1 红绿**：`node --test test/c53-skill-contract.test.mjs` 先红（模块/契约缺席）后绿。
- **G2 可复算**：`node scripts/c53-skill-contract.mjs --check` 重算通过；六组读数与落盘一致；manifest sha256 一致。
- **G3 Skill 门禁**：`npm run skills:check` PASS（13 内置）；`node scripts/post-s7-skill-integrity.mjs --check` PASS（13 条 builtinSha256 一致）；发现桥 symlink 真链在场。
- **G4 零回归**：P0 `test/c53-design-context-pack.test.mjs` + P2 `test/c53-ia-map.test.mjs` + P3 `test/c53-visual-consistency.test.mjs` + P4 `test/c53-responsive-a11y.test.mjs` + P5 `test/c53-performance-trust.test.mjs` 零回归；docs:check/ui:audit:check 绿；零新增依赖。
- **G5 治理**：closeout 定向门 + impact-map 登记 + 六件套回写。

## 4. 完成语义

G1–G5 全绿或明确 external-blocked + 六件套回写 + 证据落 `acceptance/block475-c53-p6-skill-contract/`。本包无 UI 运行时写面（资源 JSON + 脚本 + 测试 +文档/manifest 非用户 UI 写面），如实登记；不冒充任何 pending_human_eye 项 verified。

## 5. 立项真值摸底（2026-11-18，HK-01 前）

| 读数 | 现读预期 | 真源 |
| --- | --- | --- |
| design-context 消费 | design-brief README/system 未引用五件套（升级点在册） | `resources/skills/design-brief/README.md` + `prompts/system.md` |
| IA 映射消费 | 现读未显式引用 ia-map（升级点在册） | 同上 + `resources/design-context/ia-map.json` |
| a11y 约束消费 | 现读未显式引用 responsive-a11y（升级点在册） | 同上 + `resources/design-context/responsive-a11y.json` |
| Skill 版本 | 当前 1.0.0 → 目标 1.1.0（两处同步） | `design-brief/skill.json` + `resources/skills/manifest.json` |
| 发现桥 | `.codebuddy/skills/petri-ui-design` 真 symlink 在场；`.claude` 下无该桥属既有（git 仅 4 桥），本包零退化 | `.agents/skills/petri-ui-design/SKILL.md` |
| 观感留槽 | pending_human_eye 保持 in_progress | UI 台账 pending_human_eye 项 |

## 6. 收口记录（2026-11-18）

HK-01 红→绿 11/11（模块缺席 ERR_MODULE_NOT_FOUND → 11/11）；`--check` PASS（readingIds=6，contextRefs=5，iaRef=true，a11yRef=true，version=1.1.0，bridgeReal=true）。六组读数：designContextConsumption（README/system 引用 5/5 五件套 + manifest + 目录）/ iaConsumption（ia-map/路由/高频路径/重定向）/ a11yConstraints（键盘/焦点/ARIA/对比度/触摸目标/断点 + responsive-a11y.json）/ skillVersionContract（1.1.0 两处对齐 + 三类 capabilities + builtinSha256 重算）/ bridgeAlignment（Agent skill Governing sources + .codebuddy 真 symlink）/ humanEyeSlots（in_progress 零代签）。Skill 升级 design-brief README/system/skill.json/manifest（v1.1.0）+ `.agents/skills/petri-ui-design/SKILL.md` 对齐；P0–P5 + design-brief + integrity Node 65/65 零回归、skills:check PASS 13、post-s7-skill-integrity --check PASS 13、docs:check/ui:audit/hygiene 绿；零 UI 运行时写面/观感代签/新依赖/发现桥退化。证据=acceptance/block475-c53-p6-skill-contract/。C-53 P7 待后续发令。

## 7. 收口门禁归属（2026-11-18）

- `quality:perf` packaged_start 继承抖动（G0 噪声，在册）——本批零 perf 运行时面改动，归属既有基线，closeout 以 `--skip=quality:perf` 如实标 SKIPPED（不算 PASS）。
- `test-affected.test.mjs:90` 的 block464/block470 evidence gap = HEAD 既有映射盲区；按 P2–P5 先例 commit 后 closeout，diff 干净后两既有红不入范围。

G0 开发期常态 · 不外推 packaged/Provider/GA。
