---
capability: block481-c52-p5-reference-board-review
status: completed
kind: work-package
truthDomain: block481-c52-p5-reference-board-review
entrypoint: docs/README.md
goal: C-52 余项第 5 包（P5 参考板与评审法）——从 canonical 真源机械冻结「Pinterest 灵感画板 / Refero DESIGN.md 结构化 / CTA-Footer 模块级观察 / 仅评审素材不进产品」四类借鉴边界，产模型可读契约 reference-board-review.json + 消费测试锚定；只做评审方法模式借鉴与契约冻结，零产品依赖、观感 pending_human_eye 零代签。此包为 C-52 余项收官包。
acceptance:
  - HK-01 红绿先行：消费测试先红（扫描器模块缺席 ERR_MODULE_NOT_FOUND）后绿 11/11；含篡改负测 fail-closed（观感翻态/加品牌依赖/注入品牌指纹/翻许可证来源一律判红）
  - 契约可复算：collectReferenceBoardReview(root) 纯函数从六组真源机械复算，落盘快照与 resources/design-context/reference-board-review.json 逐读数深等；--check 重算与落盘一致；manifest sha256 由生成器维护并一致
  - 六组读数：inspirationBoard（Pinterest 灵感画板法：reference-analysis 五步 + 观察/借鉴分离 + 只取设计原子 + tool-matrix Pinterest 行）/ structuredDesignMd（Refero DESIGN.md 结构化：design-brief-template 十节 + design-brief Skill v1.1.0 + design-context.json + ia-map.json）/ moduleObservation（CTA/Footer 模块级观察：module-state-matrix 八态 + pre-delivery review-checklist + tool-matrix CTA/Footer 行）/ reviewMaterialOnly（仅评审素材不进产品：前端零品牌指纹 + Zero new dependencies + Internal reference process only + 产品/内部决策分离）/ licenseProvenance（来源许可登记：LICENSE_REGISTER 四来源 + P5 条目 + Record provenance + license_unknown guard + brief §9）/ boundaries（观感零签 + 零依赖 + 不替换 SimpleChat + 不抄整页皮肤 + 不做全局换皮 + 四来源许可证）
  - 观感零代签：UI-706/707/709/710 保持 in_progress + pending_human_eye、零 verified；契约 boundaries.humanEyeSigned=false、readOnly=true、noBrandCopy=true；本包无 UI 运行时写面
  - 零新增产品依赖、零 CSS/token/组件写面；closeout 定向门禁 + impact-map 登记 + 六件套回写
---

# BLOCK-481 · C-52 余项 P5 参考板与评审法借鉴与契约冻结（completed / P5-LAUNCH→CLOSED 一次会话收口）

> **发令**：用户 2026-11-18 发令「开始 C-52-P5」；纪律=单工作包串行、HK-01 红绿先行、每步定向测试 + closeout 门禁 + 证据落 acceptance/ + 六件套回写 + commit/push；红线=观感项（pending_human_eye）零代签、新裁决点/产品级新依赖/G1+ 停下报用户、未获发令不启动后续阶段。
> **范围定形**：发令边界逐字对应 `docs/pending-work-backlog.md` C-52 条目 ⑥——「P5 参考板与评审法=Pinterest 灵感画板、Refero `DESIGN.md` 结构化、CTA/Footer 模块级观察，仅评审素材不进产品」。Petri 在 `.agents/skills/petri-ui-design/references/`（reference-analysis / design-brief-template / module-state-matrix / review-checklist / tool-adoption-matrix）+ `resources/skills/design-brief`（v1.1.0）+ `resources/design-context/`（design-context/ia-map）已有本地主权评审法锚点，四类边界均可纯静态冻结、零产品写面、零观感代签。本包为 C-52 余项（P2–P5）收官包。
> **来源**：`docs/AUDIT-LOG.md` BLOCK-480 收口行「C-52 P5 保持候选未启动待发令」；backlog C-52 候选登记行 P5 定义。

## 1. 范围（scope）

1. **静态扫描器**：新增 `scripts/c52-reference-board-review.mjs`——纯函数 `collectReferenceBoardReview(root)` 从六组 canonical 真源机械复算六组读数（详见 frontmatter acceptance），暴露 6 个 scan 子函数 + `validateReferenceBoardReviewIntegrity` + `LICENSE_REGISTER`（四来源许可证登记，与 P2/P3/P4 同源冻结）。
2. **模型可读契约**：落盘 `acceptance/block481-c52-p5-reference-board-review/reference-board-review-snapshot.json`（六组读数快照）+ `resources/design-context/reference-board-review.json`（模型可读契约）+ `resources/design-context/manifest.json` 追加条目（sha256 生成器自维护）。
3. **消费测试**：`test/c52-reference-board-review.test.mjs`——结构完整/逐读数现读一致/四类借鉴边界断言/manifest sha/篡改负测/零回归基线，共 11 项；HK-01 红→绿留痕。
4. **impact-map 登记**：C-52 P5 规则（scripts/test/契约 JSON/证据目录归类），保证新测试纳入定向范围。

## 2. 非范围（exclusions）

- 任何 .tsx/CSS/token 写面（只读扫描，零 UI 运行时写面）；观感签字（pending_human_eye 零代签，UI-706/707/709/710 + E 类 + 签字槽保持 in_progress）；
- 引入 Pinterest / Refero / CTA Gallery / Footer Design / 21st.dev / shadcn / magicui / assistant-ui / React Bits 等任何产品级新依赖或 UI kit（许可证只登记不引入）；复制品牌标志/文案/插画/整页布局/营销页 CTA-Footer 模式；
- 全局换皮 / 改 design charter 默认档 / 替换 SimpleChat / 把营销 CTA-Footer 模式照搬进桌面 Agent；
- 后续阶段与工作包（C-52 余项到此收官，不自动续）；他方 WIP（`docs/architecture/gateway-design.md`）零触碰；用户 untracked 资产零触碰；G1+。

## 3. 验收门禁与证据

- **G1 红绿**：`node --test test/c52-reference-board-review.test.mjs` 先红（ERR_MODULE_NOT_FOUND）后绿 11/11。
- **G2 可复算**：`node scripts/c52-reference-board-review.mjs --check` 重算通过；六读数与快照逐读数深等；manifest sha256 一致。
- **G3 零回归**：C-52 P2/P3/P4 + C-53 P0–P7 契约测试 Node 零回归（共用 manifest 面）；theme-token-contract 19/19；`test:suggest/doc:suggest --supply=cloud`；docs:check/ui:audit:check；零新增依赖。
- **G4 治理**：closeout 定向门 + impact-map 登记 + 六件套回写（plan/roadmap/handoff/AUDIT-LOG/ui-audit/DOC-REGISTRY + README 入口）。

## 4. 完成语义

G1–G4 全绿 + 六件套回写 + 证据落 `acceptance/block481-c52-p5-reference-board-review/`。本包无观感面（扫描器/契约 JSON/测试均非用户 UI 写面），如实登记；不冒充任何 pending_human_eye 项 verified。本包为 C-52 余项收官包，不启动后续阶段，留用户后续裁决。

## 5. 启动记录（2026-11-18）

用户发令「开始 C-52-P5」；启动恢复：AUDIT-LOG 无 🔴/🟢；HEAD 281b0872 与 origin/main 同步；Node 24.20.0；串行槽位空；唯一他方 WIP `docs/architecture/gateway-design.md`（BLOCK-478 已登记，零触碰）；品牌指纹在 frontend/src 零命中；UI-706/707/709/710 台账四槽 in_progress + pending_human_eye 在场。

## 6. 收口记录（2026-11-18）

HK-01 红→绿 11/11（缺席红 ERR_MODULE_NOT_FOUND → 11/11，含四类篡改负测 fail-closed：观感翻态 humanEyeZeroSign=false / 翻许可证来源 p5Entry=false / 加品牌依赖 zeroNewDependencies=false / 注入 pinterest 品牌指纹 noBrandFingerprint=false）；生成器首轮即过全部不变量（analysisSteps=5、briefSections=10、stateMatrixStates=8、licenseSources=4、humanEyeZeroSign=true）；--check PASS；C-52 P2/P3/P4/P5 + C-53 P0–P7 共 11 份契约测试 Node 112/112 零回归、theme-token-contract 19/19、manifest sha 一致。test:suggest 零建议（area_none, confidence 0.81）、doc:suggest 建议回写 planDoc（六件套已落实）、output:judge fit=3.44(pass) 但稳定性探针 unstable（一致率 0.3333，判词质疑「零新依赖」缺可核对输出支撑——本包扫描器 noNewDependency/zeroNewDependencies 读数已机械校验根/前端 package.json，有契约证据支撑，judge 为 advice 不改变退出码）。零 UI 写面/观感代签/新依赖/抄品牌资产/照搬营销 CTA-Footer/全局换皮。证据=acceptance/block481-c52-p5-reference-board-review/。C-52 余项（P2–P5）全阶段收官，本包为收官包；后续阶段未发令不启动。

## 7. 收口门禁归属（2026-11-18）

本包自身门逐个验证全绿：ui:audit:check（642）/ hygiene:check PASS（零残留、6 项本包 WIP 仅列出、他方 WIP gateway-design.md 零触碰、全真 symlink）/ gate:code-size PASS（86301 基线不动）/ gate:arch-cycles PASS（12 存量环无新增）/ gate:css-modules PASS（11 白名单）/ quality:secret PASS / quality:arch PASS（R1–R5 无违规）/ quality:lint 0 error（2442 warnings 存量基线不动）/ quality:types 绿 / quality:knip:check PASS（346 键冻结）。

closeout 聚合链 stop 于 `docs:check` 第 3 门（fail-fast），其后门逐个单跑验证：
- **既有红（非本包文件面，如实归属，不表述为本包通过/失败）**：`docs:check` 的 `DOCUMENT_MISSING docs/post-h9-optimization-blueprint-2026-11-10.md`（受保护未跟踪 living-plan，HEAD 全史 0 commit/无 blob，P2/P3/P4 收口同归属）；`test:changed` 单红（`test-affected.test.mjs` 报 block464/470/477 `evidence.json` 未映射既有债务，本包证据用 snapshot/evidence.md 非 `evidence.json`，不新增此项）。本包新增 11 项测试全绿（含在 test:changed 118 pass 内）。

coverage 计数漂移（documentCount 635→636 / managedMarkdown 617→618）由新增本 plan 文档引起，已 `npm run docs:coverage` 重算写回。上述既有红不重打基线掩盖。audit:compact 淘汰 1 行历史链，本包启动行完好。

G0 开发期常态 · 不外推 packaged/Provider/GA。
