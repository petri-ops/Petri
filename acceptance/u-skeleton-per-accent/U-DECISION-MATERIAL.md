---
kind: u-class-decision-material
truthDomain: ui-visual-art-direction-2026-11-20
status: pending_user_ruling
generatedAt: 2026-11-20
trigger: "用户发令「行」= 做 U 类裁决包；问题：骨架是否随 data-accent 档位切换（让宣纸真的变纸底）"
---

# U 类裁决材料：骨架随档切换（2026-11-20）

## 1. 问题与背景

V5 已让四套和声（`paper-vermilion` / `celadon-ink` / `ultramarine-brass` / `indigo-mist`）注册为 `[data-accent]` 新档，实机 17/17 证明**点睛色**随档变。但截图证实：页面**骨架仍是海军蓝**（`--petri-bg-canvas: #0b1220` 等由 `[data-theme]` 单独定义），所以"宣纸档"并不真呈现宣纸底。

用户诉求原话：「可见品牌面都加入，设置上面可以切换不就可以了吗，同样的道理其它都适用」→ 需裁决是否把骨架也纳入档位切换。

## 2. 机械约束（现读证据）

| 约束 | 位置 | 对"在 accent 块写骨架 hex"的影响 |
|---|---|---|
| **c53 navyLadder** | `scripts/c53-visual-consistency.mjs:109-126`，对 `--petri-bg-{tier}: #hex` 取**全文最后一次**定义并要求与 charter 阶梯一致 | **硬红**：accent 块在 dark 块之后，写 `--petri-bg-canvas: #f2efe6` 会顶掉 dark 阶梯读数，`collectVisualConsistency` 直接 throw |
| slate/navy 家族禁令 | `theme-token-contract.test.ts:71-88`，禁 4 个字面值 | 暖白 `#f2efe6` 不在禁令表 → 不红（只误用禁值才红） |
| dark 成对棘轮 | 同文件:159-206 | `\[data-theme='dark'\]` regex 会把 accent-dark 块算入 darkTokens；骨架已在 :root/dark 成对 → 不红 |
| 重复定义禁 | 同文件:143-157（强 `html` 前缀） | accent 块不在扫描范围（盲区，非许可） |
| raw fallback / accent 棘轮 | 同文件:240-283 / :418-484 | 写字面 hex 不红；写 `var(--petri-ink-*, #hex)` 或 `var(--petri-accent)` 引用则红 |
| accent 正交纪律 | `accents.ts:4-7`（"只覆盖 accent 族、其余 token 不动"）、`ThemeProvider.tsx:251-272`（两属性独立注入） | 写骨架进 accent 块 = **设计契约违规**（accent 维度承载明/暗骨架），非机械红但属架构问题 |

## 3. 三个可判据方案（只给一条推荐）

**方案 A — 保持现状（accent 只管点睛）**
- 范围：零改动；四档继续只换 accent + `--petri-ink-*`。
- 代价：用户"切档后大面没变"的体感持续，`ART-DIRECTION` 的"宣纸主题"无法一眼可见。
- 门禁：全绿，零风险。

**方案 B — 新建 `data-surface` 正交维度（推荐）**
- 范围：新增 `html[data-surface='paper'|'indigo'|...]` 维度，由独立控件（或随 accent 联切）设置；surface 块覆盖 `--petri-bg-*` / `--petri-border*` / `--petri-text*`，并把 c53 navyLadder 改为**只认 `:root`/`[data-theme='dark']` 主块**（不认 surface 覆盖块），使覆盖成为合法例外而非违规。
- 代价：中等——新增一个维度 + 改一处扫描器口径 + 明暗双套 × 四 surface 的对比度复核（32 对基本盘需按档重测）。不动 accent 棘轮、不违反正交纪律。
- 收益：宣纸档真变宣纸底，群青档真变群青骨架，用户诉求完整达成。
- 门禁：`quality` 链绿；c53 navyLadder 口径调整需在新工作包内做 HK-01 红绿（先写"surface 覆盖不被误判"的红测）。

**方案 C — 直接把骨架 hex 写进 accent 块**
- 范围：最小改动，四档各写 4 行骨架 hex。
- 代价：**c53 navyLadder 必红**，除非改扫描器；且违反 accents.ts 正交契约；骨架色与暗色"非机械反色"表达冲突。
- 判断：不建议——用最小改动换契约破坏，后续债更大。

## 4. 单一推荐与一句理由

**推荐方案 B**（新建 `data-surface` 正交维度）。
**理由**：它唯一同时满足"骨架真随档变"、"保住 accent/theme 两维正交与暗色非反色纪律"、"机械门禁有明确合法例外"三个条件；A 不解决问题，C 破坏契约。

## 5. 裁决边界

- 本材料**不改代码**；status=`pending_user_ruling`。
- 用户回「行」= 采纳 B，下一包按 B 做 HK-01 红绿（surface 维度 + c53 口径调整 + 逐档对比度）。
- 用户回「不行」= 维持 A 或给新方向；不追问、不开菜单。
- 与 V2 的断点 U 类、状态色合并 U 类彼此独立，可分别裁决。

## 6. 证据索引

- 探查结论：c53 `scanNavyLadder` 全文最后一次定义约束（`scripts/c53-visual-consistency.mjs:109-126`）。
- accent 正交契约：`frontend/src/themes/accents.ts:4-7`、`ThemeProvider.tsx:251-272`。
- V5 现有四档双套：`frontend/src/styles/custom.css:1264-1354`、`acceptance/v5-harmony-accents/live/`（四档截图）。
- 可复用门禁形态：`frontend/src/themes/HarmonyAccents.test.ts:58-72`。
