# A4 观感预审闭环记录（2026-11-20）

## 偏好标准（用户原话，已定稿 canonical）

「简单文字少，布局和谐」（`docs/user-preferences-codification.md:51`，UI-716 首例同标准）。用户 2026-11-20 裁决：偏好预审通过即视为签字（预审→优化建议→自动优化→复验，≤3 轮，仅呈现面，逐条判据 + 证据留痕）。本次适用对象 = UI-717（身份色板 token 化 + A2/A3/V1 加映的视觉呈现面）。

## 第 1 轮（round1/）：16/16 断言过，但人工复核发现**假绿**

- 证据：`round1/a4-editorial-preference-live-darwin.json`（16/16）+ `round1/{welcome,settings,extensions}.png`。
- 假绿抓真：DOM 断言 `P1/P2_settings_*` 命中的是 `.petri-desktop-panel__title`（宽 0、不可见的模板元素，text=「设置」）；截图里用户实际看到的是 `.petri-settings-section__heading h3`「外观」，字距仍 0.01em、无落印位。→ 判据写在看不见的元素上 = 无效签字。
- 例外如实登记：runner `run.cjs` 加载 138 个 flow 时 BLOCK-463 有顶层副作用抢占 9223/CDP（非本包缺陷，未修），故用 `run-a4.cjs` 只 require 本 flow、沿用 `lib.createRun` 同构证据契约。
- 优化建议（仅呈现面）：① 字距 0.01→0.03em 与落印位改挂**真实可见**的分区标题；② 测试改断言可见元素；③ 落印位宽度断言用 3px±0.1 容差（subpixel 2.99805px 是渲染舍入非缺陷）。

## 优化（已执行，仅呈现面）

- `frontend/src/components/desktop/settings-redesign.module.css`：可见 `.petri-settings-section__heading h3` 字距 0.03em；`::after` 3px 中性落印位（`--petri-text-tertiary`）。隐藏 panel title 的同名规则保留（不删功能面）。
- `frontend/src/styles/EditorialRhythm.test.ts` 与 A4 flow 同步改锚可见元素；零 TSX 结构变更、零功能语义变更、零新依赖。

## 第 2 轮（round2/）：16/16 全过，判据逐条

| 判据 | 标准（偏好原话/艺术指导） | 实测 | 结果 |
|---|---|---|---|
| 文字少 | 欢迎副标题 ≤120 字 | 42 字 | PASS |
| 文字少 | 设置可见分区标题 ≤4 字 | 「外观」2 字 | PASS |
| 布局和谐 | 三面无横向溢出 | welcome/settings/extensions 全 0 溢出 | PASS |
| 布局和谐 | 标题宽字距（竖排重量转译） | 欢迎 0.040em / 设置可见标题 0.030em | PASS |
| 点睛 | 落印位 3px 中性 | 2.99805px（subpixel）+ `--petri-text-tertiary` | PASS |
| 图标原子 | active tab 错落格、同笔宽 1.75 | active=1 / withAtom=1 / stroke=1.75 | PASS |
| 焦点 | 每视图点睛 ≤1 | 1 | PASS |

证据：`round2/a4-editorial-preference-live-darwin.json`（16/16 allPass）+ `round2/{welcome,settings,extensions}.png`。

## 结论

两轮（≤3）闭环：第 1 轮抓真假绿 → 仅呈现面优化 → 第 2 轮逐条判据全过。**按 2026-11-20 用户裁决，偏好预审通过即视为观感签字**，UI-717 由 `in_progress` 翻 `verified`（dev Electron / 9223 离屏边界内）。静态契约 5/5 同步绿；零新依赖/零功能语义变更/不碰 G1+。

## 边界与例外

- 本签字仅覆盖 UI-717 的 V0–V1 视觉呈现面（色板 token / 图标原子 / 排版落印 / accent 密度），不外推到其它 UI-### 或 E 类人眼槽。
- 第 1 轮 runner/BLOCK-463 顶层副作用、accent targetMet 未达 130（V1 已如实登记 U 类）均不属本轮签字范围，原样保留。
- **第 3 轮（V1-U 之后，2026-11-20）未通过**：`round3/a4-editorial-preference-live-darwin.json` 0/1 FAIL，根因 backend :3001 死、`restart-dev-stack.sh` TIMEOUT（api=000/vite=200），`cdp_not_ready_on_port_9223`。未伪造截图、未开窗。处置：round2 已验证的静态面维持 verified；V1-U 新增的 hover/active 交互呈现**未获实机复审**，待栈恢复补跑 round3 后方可对该面声称通过。证据见 `acceptance/v1u-accent-semantics/GATE-LEDGER.md`。
