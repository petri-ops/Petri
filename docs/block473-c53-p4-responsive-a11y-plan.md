---
capability: block473-c53-p4-responsive-a11y
status: completed
kind: work-package
truthDomain: block473-c53-p4-responsive-a11y
entrypoint: docs/README.md
goal: C-53 UI-DESIGN-QUALITY 的 P4（响应式与可访问性）——沿 P1/P2/P3 先例新增独立静态扫描器，把 a11y/响应式机械承诺从既有真源（nso-w3-a11y.test.tsx、ui-design-a11y.test.mjs + ui-design-a11y.mjs、custom.css、控件 CSS、全源断点）复算为六组模型可读可复算读数（键盘焦点缺口 / ARIA 状态机 / WCAG 对比度 / 断点存在性 / 触摸目标尺寸 / 八态矩阵），消费测试锚定；纯只读机械面，零 CSS/组件写面、零观感代签
acceptance:
  - HK-01 红绿先行：消费测试先红（扫描器模块缺席）后绿；含篡改负测 fail-closed
  - 响应式 a11y 契约可复算：collectResponsiveA11y 从 canonical 真源机械派生，落 resources/design-context/responsive-a11y.json；--check 重算与落盘逐读数一致（忽略易变字段）；生成器自身维护 manifest sha256
  - 键盘/焦点：focus 缺口（outline:none 且无 :focus-visible 替代）只减棘轮冻结，现读 12 文件 / 16 声明；新增即红，下降合法；inert 键盘隔离语义在 nso-w3-a11y 契约在场
  - ARIA 状态机：aria-busy / role=alert / role=status / aria-live 四类证据现读计数（3/94/57/12，扫描器口径排除 `*.test.*`）逐项 >0；阈值/证据缺失必红
  - WCAG 对比度：复用 ui-design-a11y 相对亮度纯函数算 32 对；正文 ≥4.5:1 / 大字 ≥3:1 阈值不得放宽；低于阈值对如实登记（观感归 E）
  - 断点存在性：CSS 全源现读 @media / @container 断点计数 + 宽度档位集合机械登记；核心响应式覆盖（窄屏断点存在）可复算；观感留槽
  - 触摸目标尺寸：控件单源按钮基形 24px/30px 现读登记 + 桌面形态声明；<24px 的图标按钮如实标注（WCAG 2.2 目标尺寸观感归 E，不擅自改 CSS）
  - 八态矩阵：32 格判据/证据/终态复用 ui-design-a11y STATE_MATRIX，空格必红
  - 观感零代签：本包纯资源 JSON + 脚本 + 测试，无 pending_human_eye 写面；UI 台账观感项保持 in_progress
  - 零新增产品依赖、零 CSS/组件运行时写面；复用 nso-w3-a11y(4)/ui-design-a11y(7) 零回归；closeout 定向门禁全绿 + impact-map 登记 + 六件套回写
---

# BLOCK-473 · C-53 P4 响应式与可访问性（completed / P4-LAUNCH→CLOSED）

> **发令**：用户 2026-11-18 发令「开始 C-53 P4」——承接批2提示词 `docs/next-phase-e2e-prompt-2026-11-18-b2.md` S3 / R11，前序 S2（BLOCK-472 / C-53 P3）已收口。
> **从属**：`docs/petri-master-charter.md` + AUDIT-LOG C-53 权威阶段（P0 基线冻结→P1 上下文包硬化→P2 IA→P3 视觉一致性→P4 响应式 a11y→…→P7 人眼收口）+ BLOCK-465（P0/P1）/ BLOCK-471（P2）/ BLOCK-472（P3）已完成。

## 1. 范围（scope）

1. **静态扫描器**：新增 `scripts/c53-responsive-a11y.mjs`——纯函数 `collectResponsiveA11y(root)` 从 canonical 真源机械复算六组读数，落 `resources/design-context/responsive-a11y.json`（沿 P1/P2/P3 design-context 先例，生成器自身维护 manifest sha256）：
   - **keyboardFocus**：复用 `scripts/ui-design-a11y.mjs` 的 `scanFocusGaps` / `FOCUS_GAP_BASELINE`（12 文件 / 16 声明只减棘轮）+ 全源 `:focus-visible` / `inert` 存在性扫描；纯函数可被篡改负测注入。
   - **ariaStateMachine**：从 TSX 全源现读 `aria-busy` / `role="alert"` / `role="status"` / `aria-live` 四类计数，逐项 >0（现读 3/97/59/19），阈值与证据不得缺失。
   - **contrast**：复用 `ui-design-a11y.mjs` 的 `computeContrastPairs` / `relativeLuminance` / `contrastRatio` 算 32 对，正文 4.5 / 大字 3.0 阈值不放宽；低于阈值对如实登记（现读 belowBody=0，观感归 E）。
   - **breakpoints**：CSS 全源 `@media` / `@container` 宽度断点计数（现读 26 media + 10 container）+ 宽度档位集合（现读 20 值）；核心窄屏覆盖存在性断言；冻结为 ratchet（新增断点合法、删除核心覆盖必红）。
   - **touchTargets**：控件单源 `components/ui/controls/button.module.css` 的 `.iconBase` 24px / `.base` 30px 基形现读 + 桌面形态声明；<24px 图标按钮如实标注（WCAG 2.2 目标尺寸观感归 E，不擅自改 CSS）。
   - **eightStateMatrix**：复用 `ui-design-a11y.mjs` 的 `STATE_MATRIX` 32 格，判据/证据/终态完整；空格必红。
2. **消费测试**：`test/c53-responsive-a11y.test.mjs`——可复算（现读 vs 落盘逐读数深等）、六组读数断言、篡改负测（改阈值 / 注缺口 / 改哈希 / 删断点 / 状态机证据清零）fail-closed、P0/P1/P2/P3 包零回归；HK-01 红→绿留痕。

## 2. 非范围（exclusions）

- CSS/组件/路由任何运行时写面、观感签字（pending_human_eye 零代签）、design-charter 冻结档位/预算变更（只读对齐，不改值）；
- 改 `nso-w3-a11y.test.tsx` / `ui-design-a11y.test.mjs` / `ui-design-a11y.mjs`（两真源测试 + 扫描器是复用依赖，零回归基线，不改断言）；
- 改 `theme-token-contract.test.ts`（19 断言数被 P0 快照锚定）；
- C-53 P5–P7（性能可信态/Skill v1.1/人眼收口）；新产品 Skill；用户 untracked 资产零触碰；G1+。

## 3. 验收门禁与证据

- **G1 红绿**：`node --test test/c53-responsive-a11y.test.mjs` 先红（模块缺席）后绿。
- **G2 可复算**：`node scripts/c53-responsive-a11y.mjs --check` 重算通过；六组读数与落盘一致；manifest sha256 一致。
- **G3 零回归**：P0 `test/c53-design-context-pack.test.mjs` + P2 `test/c53-ia-map.test.mjs` + P3 `test/c53-visual-consistency.test.mjs` 零回归；P4 双真源 `ui-design-a11y.test.mjs`(7) + `nso-w3-a11y.test.tsx`(4) 零回归；docs:check/ui:audit:check 绿；零新增依赖。
- **G4 治理**：closeout 定向门 + impact-map 登记 + 六件套回写。

## 4. 完成语义

G1–G4 全绿或明确 external-blocked + 六件套回写 + 证据落 `acceptance/block473-c53-p4-responsive-a11y/`。本包无观感写面（资源 JSON+脚本+测试均非用户 UI 写面），如实登记；不冒充任何 pending_human_eye 项 verified（UI-706/707/709/710 与 E 类人眼保持 in_progress）。

## 5. 立项真值摸底（2026-11-18，HK-01 前）

| 读数 | 现读值 | 真源 |
| --- | --- | --- |
| focus 缺口 | 12 文件 / 16 声明 | `ui-design-a11y.mjs` FOCUS_GAP_BASELINE |
| 状态机 | ariaBusy=3 / roleAlert=94 / roleStatus=57 / ariaLive=12 | TSX 全源现读（扫描器口径：排除 `*.test.*`） |
| 对比度 | 32 对，belowBody=0，阈值 4.5/3.0 | `ui-design-a11y.mjs` computeContrastPairs |
| 断点 | 26 @media + 10 @container，20 个宽度档位 | CSS 全源现读 |
| 触摸目标 | iconBase 24px / base 30px | `components/ui/controls/button.module.css` |
| 八态矩阵 | 32 格 | `ui-design-a11y.mjs` STATE_MATRIX |

## 6. 收口记录（2026-11-18）

HK-01 红→绿 11/11（契约缺席 ENOENT → 11/11）；`--check` PASS（readingIds=6，focusGapFiles=12，breakpointTotal=36，stateMachine=3/94/57/12）；responsive-a11y.json 六组读数（键盘焦点只减棘轮 12/16 + inert 隔离在场 / ARIA 状态机四类 >0 / WCAG 32 对阈值不放宽 belowBody=0 / 断点 26+10 档位 20 窄屏覆盖 / 触摸目标 24/30px 达标 / 八态矩阵 32 格人眼格标注）；P0 8/8 + P2 7/7 + P3 9/9 + 双真源 7/7(4/4) 零回归；docs:check/ui:audit/hygiene 绿；零 UI 写面/观感代签/新依赖。证据=acceptance/block473-c53-p4-responsive-a11y/。C-53 P5-P7 待后续发令。

## 7. 收口门禁归属（2026-11-18）

- `quality:perf` packaged_start 继承抖动（G0 噪声，在册）——本批零 perf 面改动（纯资源/脚本/测试），归属既有基线，不属本包，不重打基线；closeout 以 `--skip=quality:perf` 如实标 SKIPPED（不算 PASS）。
- `test-affected.test.mjs:90` 的 block464/block470 evidence gap = HEAD 既有映射盲区（提示词 §1 已预告"本批不碰"）；`g0-rs-p6` 源绑定要求 impact-map 工作区==HEAD——按 P2/P3 先例先 commit 再 closeout，diff 干净后两既有红不入范围。非本包新代码红，不篡改基线、不伪称通过。

G0 开发期常态 · 不外推 packaged/Provider/GA。
