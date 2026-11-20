# V1-U 语义收敛 · 门禁账（2026-11-20）

## 用户裁决与建议（非判据决策点③）

用户「行」= 采纳唯一建议：只收敛 hover/active 的**文字** accent（底色/边框仍承载反馈），focus 环 / 主按钮 / 链接 / 状态色保留。理由：focus 环是 WCAG 底线，抹掉它省下的引用远不如代价大。

## 结果：316 → 269（−47），targetMet 仍 false（诚实）

原估算「约 215」偏乐观：47 处文字色全收敛 −47，但 34 条规则本就带 accent-border / accent-bg 作为**语义反馈**，按建议「保留反馈通道」不动，故落 269 而非 215。未伪造 targetMet、未动 focus/按钮/链接/状态。

## 实现（仅呈现面）

- `scripts/v1u-accent-semantics.mjs`（白名单·幂等·dry-run 审计）：hover/active 规则 `color: var(--petri-accent)` → `--petri-text`；原本无其它反馈通道者（13 条）补 `background: var(--petri-hover)`；34 条已有 border/bg 反馈者只换文字色。
- 转换清单从 **Git HEAD 真源** 重建（47 条，含完整选择器）落 `converted.json`，测试只校验这 47 条，避免误伤存量中性规则。
- `theme-token-contract.test.ts`：仅 accent 棘轮块内 13 个逐文件计数下调（只减不增）；曾误改其它棘轮表，已 `git checkout HEAD` 恢复后作用域重跑，主契约 19/19。
- c53 快照重生成 `accentTotal=269`、`targetMet=false`；`--check` 一致。

## 自身门（全绿）

| 门 | 结果 |
|---|---|
| HK-01 红→绿 | 红 3fail/2pass → 绿 5/5（hover/active 无 accent 文字色、47 条转换全有反馈通道、focus 环保留、总量下降、不伪造目标） |
| 六契约回归 | 6 files / 44 tests PASS |
| 主 token 契约 | 19/19（accent 棘轮作用域内下调） |
| c53 --check | 快照 269 一致 |
| TSC | 0 error |

## 观感复审：未通过（诚实，环境原因）

- A4 第 3 轮（`acceptance/a4-editorial-preference/round3/...json`）**0/1 FAIL**：`cdp_not_ready_on_port_9223`（backend :3001 dead）。
- `bash scripts/restart-dev-stack.sh` TIMEOUT（180s，api=000 / vite=200），dev 栈未能恢复；未伪造截图、未开窗取证，9223 保持已清理。
- 处置：UI-717 的 A4 round2 已验证面（欢迎/设置静态态、atom、落印位）维持 verified；**本包新增的 hover/active 交互呈现未获实机复审，该面保持未验证**，待 dev 栈恢复后补 run-a4 round3。静态契约只证明反馈通道存在，不证明视觉通过。

## HEAD 存量红（零触碰）

test:changed 裸文件名 / user-assets / silent-catch / lint 基线 / knip WIP / code-size 指纹漂移六项，非本包文件面。`block472-c53-p3-visual-consistency/visual-consistency-snapshot.json` 的改动系并发 flow 写入，零触碰。
