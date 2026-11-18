# BLOCK-473 / C-53 P4 响应式与可访问性 — 证据（2026-11-18）

## 发令与范围
- 用户发令「开始 C-53 P4」（批2提示词 `docs/next-phase-e2e-prompt-2026-11-18-b2.md` S3/R11）；前序 S2（BLOCK-472 / P3）已收口。
- 范围=沿 P1/P2/P3 先例新增独立静态扫描器，把响应式/a11y 机械承诺从既有真源复算为模型可读可复算契约；纯只读机械面，零 CSS/组件写面。
- 关键决策：**不改**双真源（`nso-w3-a11y.test.tsx` / `ui-design-a11y.test.mjs` / `ui-design-a11y.mjs`）——它们是零回归基线；改新增独立扫描器复用其纯函数，避免基线漂移。

## HK-01 红绿
- RED（契约缺席）：`node --test test/c53-responsive-a11y.test.mjs` → `responsive-a11y-snapshot.json` ENOENT + 契约在场断言失败（pass 0 / fail 11）。
- GREEN：`tests 11 / pass 11 / fail 0` —— ①快照/契约六组读数结构完整 ②逐读数现读一致（可复算）③键盘/焦点只减棘轮 + inert 隔离在场 ④ARIA 状态机四类证据 >0 ⑤WCAG 32 对 + 阈值不放宽 ⑥断点下限 + 窄屏覆盖 ⑦触摸目标 24/30px ⑧八态矩阵 32 格 + 人眼格标注 ⑨manifest sha256 ⑩篡改负测 fail-closed ⑪P0/P1/P2/P3 + 双真源零回归。

## 现读产物
- `resources/design-context/responsive-a11y.json`：六组读数——
  - **keyboardFocus**：focus 缺口冻结 12 文件 / 16 声明（overRatchet=false），inert 键盘隔离语义在场（inert>0 + :focus-visible 规则>0）。
  - **ariaStateMachine**：扫描器口径（排除 `*.test.*`）现读 ariaBusy=3 / roleAlert=94 / roleStatus=57 / ariaLive=12，逐项 >0。
  - **contrast**：复用 `computeContrastPairs` 32 对，正文 4.5 / 大字 3.0 阈值不放宽，belowBodyCount=0（若低于阈值如实登记，观感归 E）。
  - **breakpoints**：CSS 全源 26 @media + 10 @container（total=36），20 个宽度档位，窄屏覆盖（≤700px）在场；冻结下限 26/10/20，删除核心覆盖必红。
  - **touchTargets**：控件单源 `.iconBase` 24px / `.base` 30px，均 ≥ WCAG 2.2 目标尺寸 24px；桌面 Electron 形态；<24px 信息行（status min-height 20px）如实登记不改 CSS。
  - **eightStateMatrix**：复用 `STATE_MATRIX` 32 格，判据/证据/终态完整，pending_human_eye 格如实标注。
- `scripts/c53-responsive-a11y.mjs`：`collectResponsiveA11y`/`scanBreakpoints`/`scanAriaStateMachine`/`scanTouchTargets`/`validateResponsiveA11yIntegrity` 纯函数 + `--check`（不写盘）；契约 sha 由生成器自身维护 manifest（沿 P1/P2/P3 先例）。
- `--check` PASS（readingIds=6，focusGapFiles=12，breakpointTotal=36，stateMachine=3/94/57/12）。

## 边界与零回归
- P0 `test/c53-design-context-pack.test.mjs` 8/8、P2 `test/c53-ia-map.test.mjs` 7/7、P3 `test/c53-visual-consistency.test.mjs` 9/9 零回归；双真源 `ui-design-a11y.test.mjs` 7/7 + `nso-w3-a11y.test.tsx` 4/4 零回归。
- 观感零代签：本包无 pending_human_eye 写面（资源 JSON+脚本+测试非用户 UI 写面）；UI-706/707/709/710 + E 类 22 条保持 in_progress，不冒充 verified。
- 零产品代码/CSS/组件/运行时写面/新依赖；design-charter 冻结项零触碰；用户 untracked 资产零触碰。

G0 开发期常态 · 不外推 packaged/Provider/GA。
