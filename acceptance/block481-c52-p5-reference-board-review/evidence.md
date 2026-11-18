# BLOCK-481 / C-52 P5 参考板与评审法借鉴与契约冻结 — 证据

- 日期：2026-11-18
- 发令：用户「开始 C-52-P5」；发令边界逐字=P5（backlog C-52 条目 ⑥）
- 形态：静态扫描器 + 模型可读契约冻结，零 UI 运行时写面
- 平台：win32-x64 · Node 24.20.0

## 判据与结果

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| HK-01 红 | `node --test test/c52-reference-board-review.test.mjs`（扫描器缺席时） | 红：`ERR_MODULE_NOT_FOUND`（scripts/c52-reference-board-review.mjs 缺席），fail=1 |
| HK-01 绿 | 同上（实现后） | 绿：tests 11 / pass 11 / fail 0 |
| 可复算 | `node scripts/c52-reference-board-review.mjs --check` | `ok:true`（六读数重算与落盘 value 逐读数深等） |
| 生成器不变量 | `node scripts/c52-reference-board-review.mjs` | 首轮即过：analysisSteps=5、briefSections=10、stateMatrixStates=8、licenseSources=4、humanEyeZeroSign=true |
| 篡改负测 | 消费测试内置（4 类翻态） | fail-closed：观感翻态 / 翻许可证来源 / 加品牌依赖 / 注入品牌指纹均判红 |

## 六组读数（冻结不变量，消费测试逐读数深等）

1. **inspirationBoard**（Pinterest 灵感画板法）：analysisSteps=5（reference-analysis 五步）、observationBorrowSplit=true、designAtomsOnly=true、pinterestBoardMethod=true。
2. **structuredDesignMd**（Refero DESIGN.md 结构化）：briefSections=10（design-brief-template 十节）、briefSkillV110=true、designContextPack=true、iaMapPresent=true、referoStructuredMethod=true。
3. **moduleObservation**（CTA/Footer 模块级观察）：stateMatrixStates=8（八态）、preDeliveryChecklist=true、ctaActionHierarchy=true、footerGrouping=true。
4. **reviewMaterialOnly**（仅评审素材不进产品）：noBrandFingerprint=true（前端零品牌指纹）、zeroNewDependencies=true、internalReferenceOnly=true、productVsInternalDecided=true。
5. **licenseProvenance**（来源许可登记）：licenseSources=4、p5Entry=true、recordProvenance=true、licenseUnknownGuard=true、briefLicenseSection=true。
6. **boundaries**（边界）：humanEyeZeroSign=true、noNewDependency=true、noSimpleChatReplace=true、noWholePageCopy=true、noGlobalReskin=true、licenseRegisterSources=4。

## 观感零代签

UI-706/707/709/710 保持 `in_progress + pending_human_eye`、零 `verified`；契约 `boundaries.humanEyeSigned=false`、`readOnly=true`、`noBrandCopy=true`、`reviewMaterialOnly=true`。本包无 UI 运行时写面，观感签字全留用户。

## 范围守住

零 UI 写面 / 零观感代签 / 零新增产品依赖 / 不复制品牌标志文案插画整页布局 / 不照搬营销 CTA-Footer 模式 / 不做全局换皮 / 不替换 SimpleChat。他方 WIP `docs/architecture/gateway-design.md` 零触碰。本包为 C-52 余项（P2–P5）收官包，不启动后续阶段。

G0 开发期常态 · 不外推 packaged/Provider/GA。
