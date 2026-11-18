---
capability: block480-c52-p4-21st-snippet-library
status: completed
kind: work-package
truthDomain: block480-c52-p4-21st-snippet-library
entrypoint: docs/README.md
goal: C-52 余项第 4 包（P4 21st.dev 组件/模板片段灵感库）——从 canonical 真源机械冻结本地 UI 控件片段清单与「逐组件查许可、只作参考片段、防风格漂移、防依赖膨胀」四类借鉴边界，产模型可读契约 21st-snippet-library.json + 消费测试锚定；只做灵感库模式借鉴与契约冻结，零产品依赖、观感 pending_human_eye 零代签
acceptance:
  - HK-01 红绿先行：消费测试先红（扫描器模块缺席 ERR_MODULE_NOT_FOUND）后绿 11/11；含篡改负测 fail-closed（改许可证来源/加 UI kit 依赖/观感翻态一律判红）
  - 契约可复算：collect21stSnippetLibrary(root) 纯函数从六组真源机械复算，落盘快照与 resources/design-context/21st-snippet-library.json 逐读数深等；--check 重算与落盘一致；manifest sha256 由生成器维护并一致
  - 六组读数：snippetInventory（本地控件单源变体清单：button 7 类/status 三态/宪章五件套/按钮清单棘轮）/ licenseAudit（四来源许可证逐组件登记，21st.dev=逐组件查许可·仅片段灵感·防风格漂移与依赖膨胀）/ referenceOnly（只参考不搬：无品牌/外链/CDN 指纹、token-only 造型）/ styleDriftGuard（海军蓝四档规范 + 宪章六节 + theme-token-contract 颜色/按钮棘轮守卫）/ dependencyBloatGuard（零 UI kit 依赖 + 前端 dep 冻结上限）/ boundaries（观感零签 + 零依赖 + 不替换 SimpleChat + 四来源许可证）
  - 观感零代签：UI-706/707/709/710 保持 in_progress + pending_human_eye、零 verified；契约 boundaries.humanEyeSigned=false、readOnly=true、noBrandCopy=true；本包无 UI 运行时写面
  - 零新增产品依赖、零 CSS/token/组件写面；closeout 定向门禁 + impact-map 登记 + 六件套回写
---

# BLOCK-480 · C-52 余项 P4 21st.dev 组件/模板片段灵感库借鉴与契约冻结（completed / P4-LAUNCH→CLOSED）

> **发令**：用户 2026-11-18 发令「开始 C-52-P4」；纪律=单工作包串行、HK-01 红绿先行、每步定向测试 + closeout 门禁 + 证据落 acceptance/ + 六件套回写 + commit/push；红线=观感项（pending_human_eye）零代签、新裁决点/产品级新依赖/G1+ 停下报用户、未获发令不启动后续阶段。
> **范围定形**：发令边界逐字对应 `docs/pending-work-backlog.md` C-52 条目 P4——「21st.dev 组件/模板灵感库=逐组件查许可、只作参考片段、防风格漂移与依赖膨胀」。Petri 已有本地主权控件单源（`components/ui/controls/` + 宪章 §6），四类边界均有本地锚点可纯静态冻结、零产品写面、零观感代签。P5（参考板与评审法）保持候选、不启动。
> **来源**：`docs/AUDIT-LOG.md` BLOCK-479 收口行「C-52 P4/P5 保持候选未启动、待后续发令」；backlog C-52 候选登记行 P4 定义。

## 1. 范围（scope）

1. **静态扫描器**：新增 `scripts/c52-21st-snippet-library.mjs`——纯函数 `collect21stSnippetLibrary(root)` 从六组 canonical 真源机械复算六组读数（详见 frontmatter acceptance），暴露 6 个 scan 子函数 + `validate21stSnippetLibraryIntegrity` + `LICENSE_REGISTER`（四来源许可证登记，与 P2/P3 同源冻结）。
2. **模型可读契约**：落盘 `acceptance/block480-c52-p4-21st-snippet-library/21st-snippet-library-snapshot.json`（六组读数快照）+ `resources/design-context/21st-snippet-library.json`（模型可读契约）+ `resources/design-context/manifest.json` 追加条目（sha256 生成器自维护）。
3. **消费测试**：`test/c52-21st-snippet-library.test.mjs`——结构完整/逐读数现读一致/四类借鉴边界断言/manifest sha/篡改负测/零回归基线，共 11 项；HK-01 红→绿留痕。
4. **impact-map 登记**：C-52 P4 规则（scripts/test/契约 JSON/证据目录归类），保证新测试纳入定向范围。

## 2. 非范围（exclusions）

- 任何 .tsx/CSS/token 写面（只读扫描，零 UI 运行时写面）；观感签字（pending_human_eye 零代签，UI-706/707/709/710 + E 类 + 签字槽保持 in_progress）；
- C-52 P5（参考板与评审法）——保持候选、未发令不启动；
- 引入 21st.dev / shadcn / magicui / radix / framer-motion / assistant-ui 等任何产品级新依赖或 UI kit（许可证只登记不引入）；复制品牌标志/文案/插画/整页布局；
- 他方 WIP（`docs/architecture/gateway-design.md`）零触碰；用户 untracked 资产零触碰；G1+。

## 3. 验收门禁与证据

- **G1 红绿**：`node --test test/c52-21st-snippet-library.test.mjs` 先红（ERR_MODULE_NOT_FOUND）后绿 11/11。
- **G2 可复算**：`node scripts/c52-21st-snippet-library.mjs --check` 重算通过；六读数与快照逐读数深等；manifest sha256 一致。
- **G3 零回归**：C-52 P2/P3 + C-53 P0–P7 十份契约测试 Node 101/101 零回归（共用 manifest 面）；theme-token-contract 19/19；`test:suggest/doc:suggest --supply=cloud` 零建议；docs:check/ui:audit:check 绿；零新增依赖。
- **G4 治理**：closeout 定向门 + impact-map 登记 + 六件套回写（plan/roadmap/handoff/AUDIT-LOG/ui-audit/DOC-REGISTRY + README 入口）。

## 4. 完成语义

G1–G4 全绿 + 六件套回写 + 证据落 `acceptance/block480-c52-p4-21st-snippet-library/`。本包无观感面（扫描器/契约 JSON/测试均非用户 UI 写面），如实登记；不冒充任何 pending_human_eye 项 verified。P5 未发令不启动，留用户后续裁决。

## 5. 收口记录（2026-11-18）

HK-01 红→绿 11/11（缺席红 ERR_MODULE_NOT_FOUND → 11/11，含篡改负测：注入 shadcn 依赖 noUiKitDependency=false / 注入 magicui 片段指纹 noExternalSnippetImport=false / 观感翻态 humanEyeZeroSign=false / 许可证翻态 perComponentLicense=false）；生成器首轮即过全部不变量（controlVariantClasses=7、navySpecAligned=true、charterSections=7、licenseSources=4、humanEyeZeroSign=true、frontendDependencyCount=39≤45）；--check PASS；C-52 P2/P3/P4 + C-53 P0–P7 Node 101/101 零回归、theme-token 19/19；test:suggest 零建议（area_none）、doc:suggest 建议回写 planDoc（本六件套已落实）、output:judge fit=3.36 PASS（探针 3 次稳定）；零 UI 写面/观感代签/新依赖/抄品牌资产。证据=acceptance/block480-c52-p4-21st-snippet-library/。P5 待后续发令。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 收口门禁归属（2026-11-18）

本包自身门逐个验证全绿：ui:audit:check（642）/ hygiene:check PASS（4 个 CRLF 漂移属 P3 已完成包产物，机械归一零内容变化，他方 WIP gateway-design.md 零触碰）/ gate:user-assets PASS（10 受保护）/ gate:version-parity PASS（10）/ gate:silent-catch PASS（402 基线）/ gate:code-size PASS（86301 基线不动）/ gate:arch-cycles PASS（12 存量环无新增）/ gate:css-modules PASS（11 白名单）/ quality:secret PASS / quality:arch PASS（R1–R5 无违规）/ quality:lint 0 error（2442 warnings 存量基线不动，本包两文件 0 warning）/ quality:types 绿 / quality:knip:check PASS（346 键冻结）/ quality:surface PASS（P1/P2 新增 0）。

closeout 聚合链 stop 于 `docs:check` 第 3 门（fail-fast），其后门逐个单跑验证：
- **既有红（非本包文件面，如实归属，不表述为本包通过/失败）**：`docs:check` 的 `DOCUMENT_MISSING docs/post-h9-optimization-blueprint-2026-11-10.md`（受保护未跟踪 living-plan，HEAD 全史 0 commit/无 blob，任何干净 checkout 均现，P2/P3 收口同归属）；`test:changed` 两红（`block326 ② dev-verify --list exit 2` run.cjs 自身崩溃 + `test-affected.test.mjs` block464/470/477 `evidence.json` 未映射既有债务，本包新增 snapshot/evidence.md 非 `evidence.json`）；`quality:lint:ledger` / `quality:ear` / `gate:post-h9-contracts` 既有存量债，本包增量=0。

coverage 计数漂移（documentCount 634→635 / managedMarkdown 616→617）由新增本 plan 文档引起，已 `npm run docs:coverage` 重算写回。上述既有红不重打基线掩盖。

G0 开发期常态 · 不外推 packaged/Provider/GA。
