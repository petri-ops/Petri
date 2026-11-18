# BLOCK-475 / C-53 P6 产品 Skill v1.1 — 证据（2026-11-18）

## 发令与范围
- 用户发令「开始 C-53 P6」（批2提示词 `docs/next-phase-e2e-prompt-2026-11-18-b2.md` S5/R13）；前序 S4（BLOCK-474 / P5）已收口。
- 范围=沿 P1–P5 先例把 design-brief 产品 Skill 升级到 v1.1.0，使其契约显式消费 design-context 五件套 + IA 映射 + a11y 约束；新增独立静态扫描器从真源机械复算六组读数 + 模型可读契约 + 消费测试锚定；对齐 `petri-ui-design` Agent skill 走发现桥 symlink。
- 关键决策：**不改** P1–P5 真源 JSON 的语义部分（它们是零回归基线，只读复算）；只新增独立扫描器复用其符号/语义，避免基线漂移。零 UI 运行时写面。

## HK-01 红绿
- RED（模块缺席）：`node --test test/c53-skill-contract.test.mjs` → `ERR_MODULE_NOT_FOUND: scripts/c53-skill-contract.mjs`（pass 0 / fail 1）。
- GREEN：`tests 11 / pass 11 / fail 0` —— ①快照/契约六组读数结构完整 ②逐读数现读一致（可复算）③design-context 五件套消费 ④IA 映射消费 ⑤a11y 约束消费 ⑥Skill 版本契约 1.1.0 两处一致 + capabilities ⑦发现桥对齐（Agent skill 真源 + .codebuddy symlink 真链）⑧观感留槽零代签 ⑨manifest sha256 ⑩篡改负测 fail-closed ⑪P0–P5 + skills:check/integrity 零回归。

## 现读产物
- `resources/design-context/skill-contract.json`：六组读数——
  - **designContextConsumption**：design-brief README.md + prompts/system.md 现读引用 5/5 五件套 JSON（design-context / ia-map / visual-consistency / responsive-a11y / performance-trust）+ manifest.json + 目录路径。
  - **iaConsumption**：ia-map + 路由 + 高频路径 + 重定向关键词在场 + ia-map.json 引用在场。
  - **a11yConstraints**：键盘 / 焦点 / ARIA / 对比度 / 触摸目标 / 断点关键词在场 + responsive-a11y.json 引用在场。
  - **skillVersionContract**：skill.json version=1.1.0 且 manifest 登记 version=1.1.0 对齐；三类 capabilities 增补在场；builtinSha256 现读一致（已重算）。
  - **bridgeAlignment**：.agents/skills/petri-ui-design/SKILL.md Governing sources 纳入 design-context 包 + ia-map + a11y 契约；.codebuddy/skills/petri-ui-design 真 symlink 在场且指向 .agents/skills/petri-ui-design。
  - **humanEyeSlots**：humanEyeSigned=false / status=in_progress / 2 条观感槽清单 / readOnly=true——pending_human_eye 零代签。
- `scripts/c53-skill-contract.mjs`：`collectSkillContract`/`scanDesignContextConsumption`/`scanIaConsumption`/`scanA11yConstraints`/`scanSkillVersionContract`/`scanBridgeAlignment`/`validateSkillContractIntegrity` 纯函数 + `--check`（不写盘）；契约 sha 由生成器自身维护 manifest（沿 P1–P5 先例）。
- `--check` PASS（readingIds=6，contextRefs=5，iaRef=true，a11yRef=true，version=1.1.0，bridgeReal=true）。

## Skill 升级与发现桥
- `resources/skills/design-brief/README.md`：新增「设计上下文真源（v1.1）」段，按序消费五件套 + manifest；IA/a11y 消费要点。
- `resources/skills/design-brief/prompts/system.md`：规范锚点节补 design-context 读取顺序（十节手册其余九节零改动）。
- `resources/skills/design-brief/skill.json` + `resources/skills/manifest.json`：version 1.0.0→1.1.0、capabilities 增补 `design-context-consumption`/`ia-map-consumption`/`a11y-constraints`；`post-s7-skill-integrity.mjs --write` 重算 builtinSha256。
- `.agents/skills/petri-ui-design/SKILL.md`：Governing sources 第 6 条纳入 design-context 五件套 + ia-map + a11y 契约；`.codebuddy/skills/petri-ui-design` 为真 symlink（沿发现桥自动生效，零退化）。`.claude` 下无该桥属既有状态（git 仅登记 4 条桥），本包零新增、零退化。

## 边界与零回归
- P0 `test/c53-design-context-pack.test.mjs` + P2 `test/c53-ia-map.test.mjs` + P3 `test/c53-visual-consistency.test.mjs` + P4 `test/c53-responsive-a11y.test.mjs` + P5 `test/c53-performance-trust.test.mjs` + C-52 `test/design-brief-skill.test.mjs` + `test/post-s7-h9-skill-integrity.test.mjs` 共 65/65 零回归。
- `npm run skills:check` PASS（13 内置 Skill）；`node scripts/post-s7-skill-integrity.mjs --check` PASS（13 条 builtinSha256 一致）。
- 观感零代签：本包无 pending_human_eye 写面（资源 JSON + 脚本 + 测试 + 文档/manifest 非用户 UI 写面）；P7 人眼收口 + UI-706/707/709/710 + E 类观感签字保持 in_progress，不冒充 verified。
- 零产品运行时代码/CSS/组件/路由/IPC 写面/新依赖；design-charter 冻结项零触碰；用户 untracked 资产零触碰。

G0 开发期常态 · 不外推 packaged/Provider/GA。
