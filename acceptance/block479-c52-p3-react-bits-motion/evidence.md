# BLOCK-479 / C-52 P3 React Bits 反馈型微动效模式借鉴契约冻结 — 证据清单

> 生成：2026-11-18 · 证据类=mechanical-gate · humanEyeEquivalent=false
> 源提交：见 react-bits-motion-snapshot.json `sourceCommit`

## 一、HK-01 红绿先行

- **红**：`node --test test/c52-react-bits-motion.test.mjs`（扫描器缺席）→ `ERR_MODULE_NOT_FOUND`，`tests 1 / pass 0 / fail 1`。
- **绿**：实现扫描器并生成契约后 → `tests 11 / pass 11 / fail 0`。
- **--check**：`node scripts/c52-react-bits-motion.mjs --check` → `{ok:true, readingIds:[6]}`。

## 二、六组冻结读数（逐读数现读一致）

| 读数 | 现读要点 |
| --- | --- |
| hoverFeedback | button.module.css `transition:...var(--petri-duration-fast) var(--petri-ease-standard)` + TitleBar `.winBtn:hover` + ToastProvider `.dismiss:hover` + FloatCardResizer `.handle:hover`（21 hover 锚点） |
| pressFeedback | TitleBar `:active { transform: scale(0.92) }` + `transform var(--petri-duration-fast)` 过渡 + simple-chat `.sc-fork-btn:active`（5 active 锚点） |
| expandFeedback | LeftPanel/RightPanel/BottomTerminal 三处 `data-petri-motion="functional"` + global.css `[data-petri-motion='functional']` reduced-motion 豁免引用 `--petri-duration-base` |
| successFeedback | ToastProvider `[data-variant='success']` + `var(--petri-success)` + status.module.css `animation: spin var(--petri-duration-slow)` + global.css 全局 reduced-motion 兜底 |
| motionTokens | custom.css 三档 duration（150/200/300ms）+ 两档 ease + design-charter §4 对齐 + theme-token-contract 单调断言 + 禁字面 ms 守卫 + 281 token 引用 |
| boundaries | 零新增依赖（无 react-bits/framer-motion/assistant-ui/21st）+ 禁整页动效（reduced-motion 兜底约束）+ UI-706/707/709/710 in_progress/pending_human_eye 零 verified + 许可证四来源登记 |

## 三、篡改负测（fail-closed）

- 注入 custom.css 删去 duration tier → `durationTiers=0`，完整性判红。
- 注入 package.json 加 framer-motion 依赖 → `noNewDependency=false`，完整性判红。
- 注入观感翻态 → `humanEyeZeroSign=false`，完整性判红。
- 三组 override 篡改读数（charterAligned/noNewDependency/humanEyeZeroSign=false）均判 `validate...Integrity().ok=false`。

## 四、零回归与治理

- C-52 P2 + C-53 P0–P7 九份契约测试：`tests 90 / pass 90 / fail 0`（共用 manifest 面零回归）。
- `theme-token-contract.test.ts`：19/19（P3 复用的 canonical 动效门禁）。
- 本包自身门逐个验证全绿：ui:audit（642）/ hygiene / user-assets / version-parity / silent-catch / code-size（86301）/ arch-cycles（12 无新增）/ css-modules / secret / arch / lint（0 error，本包两文件 0 warning）/ types / knip（346 冻结）/ surface / test:changed 定向链 145 项（本包测试纳入并通过）（详见 plan §6）。
- `test:suggest --supply=cloud`：零建议（below_threshold，confidence 0.36）；`doc:suggest --supply=cloud`：零建议（below_threshold，各维 suggested=false）。
- `output:judge`：首次 fit 2.77 RETRY → 带判词重试 fit 3.12 PASS。

## 四附：closeout 聚合链既有红（非本包文件面，如实归属）

1. `docs:check` `DOCUMENT_MISSING docs/post-h9-optimization-blueprint-2026-11-10.md`：受保护未跟踪 living-plan，HEAD 全史 0 commit/无 blob，任何干净 checkout 均现；本包零触碰、不伪造。
2. `test:changed`：`block326 ② dev-verify --list exit 2`（run.cjs 崩溃，本包零 flow 面）+ `test-affected.test.mjs` block464/470/477 `evidence.json` 未映射（既有测试面债务）；本包未新增任何 `evidence.json`。
3. `quality:lint:ledger`：test 域 419>基线 418（基线 11-17 设定；本包两文件 eslint 0 warning、total 2442 回到 P2 收口 HEAD 值，增量=0）。
4. `quality:ear`：block351 assetization 五处 p0-baseline 引用丢失（既有 EAR 漂移，manifest 43.3%）。
5. `gate:post-h9-contracts`：契约 182 通过/4 红（既有，非本包文件面）。

## 五、边界声明

零 UI 运行时写面、零观感代签（pending_human_eye 保持 in_progress）、零新增产品依赖、零 CSS/token 写面、禁整页动效；C-52 P4/P5 保持候选未启动；他方 WIP（`docs/architecture/gateway-design.md`）零触碰。观感项 UI-706/707/709/710 与 E 类签字槽全留用户，零代签；本包完成仅指模式借鉴+契约冻结的非观感面。概览=G0 开发期常态 · 不外推 packaged/Provider/GA。
