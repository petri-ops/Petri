# A4 四档整体观感预审 · 判据（2026-11-20）

## 授权与边界

- 用户「可以的 冲」= 授权四档整体观感预审闭环。
- 标准：偏好原话「简单文字少，布局和谐」（`docs/user-preferences-codification.md:51`）+ 艺术指导 Q1–Q5（格物东方视觉语境）。
- 纪律：**≤3 轮**、**仅呈现面**（不改功能/token 家族/结构）、逐条判据 + 截图证据留痕；不通过项走「建议→自动优化→复验」，通过后按 11-20 裁决翻 verified。
- 取证：只在 **9223 离屏**测试实例截图，**绝不碰用户主窗 9222、绝不开可见窗**；截图失败如实标 `screenshot_unavailable`。
- 对象：四档和声 `paper-vermilion` / `celadon-ink` / `ultramarine-brass` / `indigo-mist`，逐档切 `data-accent`+`data-surface`。

## 五条逐条判据（每档独立判）

| 判据 | 标准 | 机械/实机判据 |
|---|---|---|
| **P1 文字少** | 欢迎副标题 ≤120 字、设置可见标题 ≤4 字 | DOM textContent 长度 |
| **P2 布局和谐** | 三面无横向溢出（welcome/settings/extensions） | `scrollWidth ≤ clientWidth+2` |
| **P3 骨架随档** | 四档 `data-surface` 骨架色各异、点睛色各异 | computed `--petri-bg-canvas` / `--petri-accent` 四值 distinct |
| **P4 点睛纪律** | 每视图点睛图标 ≤1、active 文字中性、反馈由边框/底承载 | DOM computed（active tab atom ≤1、文字非 accent） |
| **P5 清晰度** | 弱化字 ≥4.5:1（静态门禁已锁，实机复核不明显发虚） | SurfaceDimension 对比度门禁 + 截图人工复核 |

## 轮次与证据

- 证据目录：`acceptance/a4-harmony-preview/round1/`（首轮），`round2/`、`round3/`（如需复验）。
- 每档截图 `welcome / settings / extensions` 三面，落盘为 `<accent>-<surface>.png`（如 `paper-vermilion-welcome.png`）+ 证据 JSON（16+ 断言含 four_accents_distinct）。
- 人工复核：逐档看 P1–P5，任何不通过 → 记录具体档+判据 → 仅呈现面优化 → 下一轮复验。
- 通过条件：四档 P1–P5 全过且 ≤3 轮 → 翻四档观感 verified；否则保持 in_progress，如实标注未过项。

## 零代签边界

静态断言 + 截图只证明结构与判据满足；审美"好不好看"由人工复核签字（偏好预审通过即视为签字，按 11-20 用户裁决）。不外推 packaged/Provider/GA。
