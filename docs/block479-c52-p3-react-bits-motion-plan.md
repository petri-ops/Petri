---
capability: block479-c52-p3-react-bits-motion
status: completed
kind: work-package
truthDomain: block479-c52-p3-react-bits-motion
entrypoint: docs/README.md
goal: C-52 余项次包（P3 React Bits 反馈型微动效）——从 canonical 真源机械冻结四类反馈型微动效（hover/press/展开/成功反馈）在 Petri 本地主权形态中的既有锚点，产模型可读契约 react-bits-motion.json + 消费测试锚定；只做模式借鉴与契约冻结，复用 --petri-duration/ease token，禁整页动效、零产品依赖、观感 pending_human_eye 零代签
acceptance:
  - HK-01 红绿先行：消费测试先红（扫描器模块缺席 ERR_MODULE_NOT_FOUND）后绿 11/11；含篡改负测 fail-closed（改 token 真源/改 package.json 依赖/改观感状态一律判红）
  - 契约可复算：collectReactBitsMotion(root) 纯函数从六组真源机械复算，落盘快照与 resources/design-context/react-bits-motion.json 逐读数深等；--check 重算与落盘一致；manifest sha256 由生成器维护并一致
  - 六组读数：hover（token 驱动过渡 + 基线 :hover 态 21 锚点）/ press（:active scale + token 过渡 5 锚点）/ expand（功能性布局过渡三宿主 + reduced-motion 豁免）/ success（toast success 语义色 + spinner token + 全局兜底）/ motionTokens（三档 duration + 两档 ease + 宪章对齐 + 单调/字面量守卫 + 281 token 引用）/ boundaries（零依赖/禁整页/观感零签/许可证四来源登记）
  - 观感零代签：UI-706/707/709/710 保持 in_progress + pending_human_eye、零 verified；契约 boundaries.humanEyeSigned=false、readOnly=true、fullPageMotion=false；本包无 UI 运行时写面
  - 零新增产品依赖、零 CSS/token 写面；closeout 定向门禁 + impact-map 登记 + 六件套回写
---

# BLOCK-479 · C-52 余项 P3 React Bits 反馈型微动效模式借鉴与契约冻结（completed / P3-LAUNCH→CLOSED）

> **发令**：用户 2026-11-18 发令「开始 C-52 P3」；纪律=单工作包串行、HK-01 红绿先行、每步定向测试 + closeout 门禁 + 证据落 acceptance/ + 六件套回写 + commit/push；红线=观感项（pending_human_eye）零代签、新裁决点/产品级新依赖/G1+ 停下报用户、未获发令不启动后续阶段。
> **范围定形**：发令边界逐字对应 `docs/pending-work-backlog.md` C-52 条目 P3——「React Bits 反馈型微动效模式=hover/press/展开/成功反馈，复用 `--petri-duration/ease` token，MIT + Commons Clause，保留版权、禁整页动效、禁转售组件本身」。四类反馈型微动效在 Petri 均有本地主权锚点，可纯静态冻结、零产品写面、零观感代签。P4（21st.dev 灵感库）/P5（参考板评审法）保持候选、不启动。
> **来源**：`docs/AUDIT-LOG.md` BLOCK-478 收口行「C-52 P3–P5 保持候选未启动、待后续发令」；backlog C-52 候选登记行 P3 定义。

## 1. 范围（scope）

1. **静态扫描器**：新增 `scripts/c52-react-bits-motion.mjs`——纯函数 `collectReactBitsMotion(root)` 从六组 canonical 真源机械复算六组读数（详见 frontmatter acceptance），暴露 6 个 scan 子函数 + `validateReactBitsMotionIntegrity` + `LICENSE_REGISTER`（四来源许可证登记，与 P2 同源冻结）。
2. **模型可读契约**：落盘 `acceptance/block479-c52-p3-react-bits-motion/react-bits-motion-snapshot.json`（六组读数快照）+ `resources/design-context/react-bits-motion.json`（模型可读契约）+ `resources/design-context/manifest.json` 追加条目（sha256 生成器自维护）。
3. **消费测试**：`test/c52-react-bits-motion.test.mjs`——结构完整/逐读数现读一致/四类反馈分组断言/token 复用/边界/manifest sha/篡改负测/零回归基线，共 11 项；HK-01 红→绿留痕。
4. **impact-map 登记**：C-52 P3 规则（scripts/test/契约 JSON/证据目录归类），保证新测试纳入定向范围。

## 2. 非范围（exclusions）

- 任何 .tsx/CSS/token 写面（只读扫描，零 UI 运行时写面）；观感签字（pending_human_eye 零代签，UI-706/707/709/710 + E 类 + 签字槽保持 in_progress）；
- C-52 P4/P5（21st.dev 灵感库 / 参考板评审法）——保持候选、未发令不启动；
- 引入 react-bits / framer-motion / assistant-ui / 21st.dev 等任何产品级新依赖（许可证只登记不引入）；复制品牌标志/文案/插画/整页布局；整页动效；
- 他方 WIP（`docs/architecture/gateway-design.md`）零触碰；用户 untracked 资产零触碰；G1+。

## 3. 验收门禁与证据

- **G1 红绿**：`node --test test/c52-react-bits-motion.test.mjs` 先红（ERR_MODULE_NOT_FOUND）后绿 11/11。
- **G2 可复算**：`node scripts/c52-react-bits-motion.mjs --check` 重算通过；六读数与快照逐读数深等；manifest sha256 一致。
- **G3 零回归**：C-52 P2 + C-53 P0–P7 九份契约测试 Node 90/90 零回归（共用 manifest 面）；theme-token-contract 19/19；`test:suggest/doc:suggest --supply=cloud` 零建议；docs:check/ui:audit:check 绿；零新增依赖。
- **G4 治理**：closeout 定向门 + impact-map 登记 + 六件套回写（plan/roadmap/handoff/AUDIT-LOG/ui-audit/DOC-REGISTRY + README 入口）。

## 4. 完成语义

G1–G4 全绿 + 六件套回写 + 证据落 `acceptance/block479-c52-p3-react-bits-motion/`。本包无观感面（扫描器/契约 JSON/测试均非用户 UI 写面），如实登记；不冒充任何 pending_human_eye 项 verified。P4/P5 未发令不启动，留用户后续裁决。

## 5. 收口记录（2026-11-18）

HK-01 红→绿 11/11（缺席红 ERR_MODULE_NOT_FOUND → 11/11，含篡改负测：删 token 真源 durationTiers=0 / 加 framer-motion 依赖 noNewDependency=false / 观感翻态 humanEyeZeroSign=false）；生成器首轮即过全部不变量（durationTiers=3、easeTiers=2、hoverAnchors=21、activeAnchors=5、tokenUses=281、humanEyeZeroSign=true）；--check PASS；C-52 P2 + C-53 P0–P7 Node 90/90 零回归、theme-token 19/19；test:suggest/doc:suggest --supply=cloud 零建议（below_threshold）；零 UI 写面/观感代签/新依赖/整页动效。证据=acceptance/block479-c52-p3-react-bits-motion/。P4/P5 待后续发令。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 收口门禁归属（2026-11-18）

本包自身门逐个验证全绿：ui:audit:check 绿 / gate:code-size PASS / gate:arch-cycles PASS / gate:css-modules PASS / quality:secret PASS / quality:arch PASS（R1–R5 无违规）/ quality:lint 0 error（存量 warnings 基线不动）/ quality:types 绿 / quality:knip:check PASS（冻结键不动）。

closeout 聚合链 stop 于 `docs:check`（第 3 门，fail-fast），其后门逐个单跑验证：
- 本包自身门逐个全绿：ui:audit 绿（642）/ hygiene PASS / gate:user-assets PASS / gate:version-parity PASS / gate:silent-catch PASS / gate:code-size PASS（86301 基线不动）/ gate:arch-cycles PASS（12 存量环无新增）/ gate:css-modules PASS / quality:secret PASS / quality:arch PASS / quality:lint 0 error（2442 warnings 存量基线不动，本包两文件 0 warning）/ quality:types 绿 / quality:knip:check PASS（346 键冻结）/ quality:surface PASS / test:changed 定向链 145 项中本包 `c52-react-bits-motion.test.mjs` 纳入并通过。
- **既有红（均非本包文件面，如实归属）**：`docs:check` 的 `DOCUMENT_MISSING docs/post-h9-optimization-blueprint-2026-11-10.md`（受保护未跟踪 living-plan，HEAD 全史 0 commit/无 blob，任何干净 checkout 均现，本包零触碰不伪造）；`test:changed` 两红（`block326 ② dev-verify --list exit 2` run.cjs 自身崩溃 + `test-affected.test.mjs` block464/470/477 `evidence.json` 未映射既有债务，本包新增的是 snapshot.json/evidence.md 非 `evidence.json`）；`quality:lint:ledger` test 域 419>基线 418（基线 11-17 设定，本包两文件 eslint 0 warning、total 2442 回到 P2 收口 HEAD 值，增量=0）；`quality:ear`（block351 assetization 五处 p0-baseline 引用丢失）；`gate:post-h9-contracts`（契约 182/186，4 红既有）。

上述红如实归属既有，不表述为本包通过、不重打基线掩盖。`output:judge`：首次 fit 2.77 RETRY → 带判词重试 fit 3.12 PASS。

G0 开发期常态 · 不外推 packaged/Provider/GA。
