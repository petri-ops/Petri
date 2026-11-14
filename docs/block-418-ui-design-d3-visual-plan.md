---
capability: block-418-ui-design-d3-visual
status: completed
goal: 视觉语义统一——hover/selected 单源、跨文件重复定义收敛、裸 z 只减迁移、`;;` 清零（非 WIP）、fallback 快照按现值下调。
acceptance:
  - hover 语义 1 个真源 + selected 专用 token 明暗成对，机械门守护
  - --petri-surface-dim 跨文件重复定义 = 0（不改任何生效值）
  - 裸 z-index 精确等价迁移到 --petri-z-* 且棘轮按文件下调（只减，不放宽）
  - 颜色 fallback 快照按当次现值重打（19/235 → 17/190，下调非放宽）
  - 非 WIP CSS 的 ;; = 0；WIP 文件显式登记 owner
  - 新增判据均有植入必红负测；theme-token-contract 19/19 且棘轮数值下调
---

# UI-D3 · 视觉语义统一（BLOCK-418）

> **裁决来源**：用户 2026-11-11 预授权连续工作（同 D0–D2，留痕于 `baseline.json.plan.ruling`）。
> **truthDomain**：`block-418-ui-design-d3-visual`（层 1 唯一占用；D2 已 completed 转空）。
> **形态自检**：每项收敛落成机械门禁 + 证据链（本地可审计 / 治理透明 / 证据自证），不是一次性视觉精修；所有颜色值替换的观感归 E 类人眼，Agent 不代答、不写 verified。

## 1. 范围（按文件切片）

- **切片 A · token 语义**：`frontend/src/styles/custom.css` 把 hover 别名（5 个）统一指向唯一真源 `--petri-hover`（明暗各一定义）；新增 `--petri-selected-bg` / `--petri-selected-border` / `--petri-selected-text` 专用 token，明暗成对、由 accent 派生；`--petri-surface-dim` 保留 `custom.css` 明暗 2 处，删除 `global.css:49` 与 `:61` 的重复定义（两处生效值与 custom.css 逐字相同 ⇒ 零视觉变化）。
- **切片 B · 裸 z 只减迁移**：对取值**精确等于** 8 档之一的 `z-index` 逐值等价替换成 `var(--petri-z-*)`；不等价的值（9998/9999/10001/10002/100000 等）**不硬映射**（映射会改变层叠顺序），登记为后续切片；`theme-token-contract.test.ts` 的 z 棘轮按文件实际读数下调（只减不放宽）。实交付 7 处；另 3 处（`SvgEditorViewer` ×2 = 10、`TitleBar` ×1 = 10000）因所在文件已入 `code-size` 台账且字节棘轮「只减不增」，替换成更长的 `var(...)` 会超锚点 → **按红线不放宽基线，保留裸值并登记 `Z_TIER_FROZEN` 只减棘轮冻结清单**（清单外新增必红、清单内超限必红，负测在册）。
- **切片 C · fallback 快照重打**：`theme-token-contract.test.ts` 的 RATCHET 由 19 文件/235 处按当次现值下调为 17 文件/190 处（删除已归零的 2 键、其余只减）；新增「下调后植入新增 fallback 必红」负测（实战：临时追加 1 处 fallback → 门报 `2 > ratchet 1` 判红，还原后 19/19）。
- **切片 A′ · code-size 合法重打**：本包 CSS 收敛共 59 文件改动，其中 6 个入 `code-size` 台账文件的 sha256 漂移。先把所有入册文件的行数/字节压到 ≤ 基线（selected token 移到未入册的 `global.css`、撤销 3 处字节增长的 z 迁移），再按脚本 `--write` 重打：bytes 锚点全部**下降**（−3 至 −39）、行数持平、WIP 条目零变化 ⇒ 属真实收敛后的合法下调，不是抬高允许上限。
- **切片 D · `;;` 清零**：非 WIP 的 CSS 文件把 `;;` → `;`（纯语法、零视觉变化）；`project-workspace.module.css` 内 128 处属 W 类零触碰，由门显式登记 owner。新增 `gate:ui-visual` 统合 A–D 的机械判据与植入必红负测。

## 2. 非范围 / W 归属（硬红线）

| 项 | 归属 | 处置 |
| --- | --- | --- |
| `frontend/src/pages/project-workspace.module.css`（开局 M 11+/9−，BLOCK-395 B-11） | 他方在制 WIP | **零触碰**：该文件内 26 处裸 z、128 处 `;;`、39 处颜色 fallback 与同名 class 重复定义均不代改；逐件登记 owner 与补腿条件，D5 终态化。其 z 棘轮条目保持现值不动 |
| 不等价 z 值（9998/9999/10001/10002/100000 及 0–9 局部层叠） | 后续切片 | 不做会改变层叠顺序的映射；登记候选与量化判据 |
| 10 个组件 CSS 外溢 `--petri-*` 定义（`desktop.css` 3 / `code-highlight.css` 7） | 后续切片 | 回 `styles/` 需明暗成对 + 观感签字，本期如实标 `done-partial` 并给补腿条件 |
| 颜色值替换的观感（暗色 hover alpha 0.09 → 0.07 等） | E 类 | `pending_human_eye`，路线与签字槽在 `docs/ui-design-ia-decision-material.md` §6 |
| `src/main/_backend-ports.js` + `test/block414-backend-port-reuse.test.mjs`、用户 untracked 资产 | 并发写入者 / 用户资产 | 零触碰、零 stage、零提交 |

**判「补丁 vs 重构」**：全部为「改写主定义 + 抽机械门」的 scoped refactor，不在既有抽象上叠加条件；纯重构按 BLOCK-92 拆前拆后同套绿；颜色值唯一变化是暗色 `--petri-surface-hover` 由裸 `rgba(...,0.09)` 改指真源 `var(--petri-hover)`（0.07），属报告 VI-P1 要求的「hover 收敛到 1 档」，观感归 E 不代答。

## 3. 依赖与证据位置

| 项 | 位置 |
| --- | --- |
| 尺子 | `docs/ui-design-acceptance-checklist-v1.md` §1/§5/§6 |
| token 真源 | `frontend/src/styles/custom.css` / `global.css` |
| 棘轮 | `frontend/src/styles/theme-token-contract.test.ts`（z / fallback 两处 RATCHET） |
| 机械门 | `scripts/ui-design-visual.mjs` + `npm run gate:ui-visual` |
| 负测 | `test/ui-design-visual.test.mjs` |
| 证据 | `acceptance/ui-design-assessment-2026-11-11/d3/` |

## 4. 验收门禁（收口逐项对账）

1. `gate:ui-visual` PASS：hover 单源 / selected 明暗成对 / surface-dim 跨文件重复 = 0 / 裸 z 单调下降 / 非 WIP `;;` = 0 / fallback 快照 ≤ 现值；负测覆盖 6 类植入必红。
2. `theme-token-contract` 19/19 且两个棘轮数值**下调**（不放宽阈值、不缩分母）。
3. 拆前拆后同套绿：受影响 CSS 的相邻前端测试 + D0–D2 四门全绿。
4. `docs:check` / `hygiene:check` / `quality:types` / `quality:lint` / `ui:audit:check` / `quality:knip:check`。
5. canonical 六件套 + `docs:reconcile` 0 issues + `docs:check` PASS。

## 5. U / E / V / W

沿用 `docs/ui-design-ia-decision-material.md`（U-01～U-06、E-01～E-03、V 补腿）；W 见 §2。Agent 不代答、不冒 verified。

## 6. 完成语义

§4 五条逐项有当次证据，未达项按 §5 终态化、不计入完成数；门禁全绿是必要非充分条件。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 7. 收口笔录（2026-11-11 · COMPLETED，带 done-partial）

| §4 判据 | 当次证据 |
| --- | --- |
| 1 `gate:ui-visual` + 6 类负测 | PASS（104 CSS 文件 / hover 单源 / selected 成对有消费 / surface-dim 跨文件重复 0 / 非 WIP `;;` 0 / fallback 17 文件 190 处）；负测 9/9，含植入必红实战（临时追加 1 处 fallback → `2 > ratchet 1` 判红，还原后 19/19，探针零残留） |
| 2 token 契约 19/19 + 双棘轮下调 | fallback 19/235 → 17/190；z 38/111 → 34/104；归零键删除=更严，注释留因，未放宽阈值/分母 |
| 3 拆前拆后同套绿 | D0–D2 五门全绿零回退；`theme-token-contract` 19/19；UI 台账契约 5/5；`ui:audit:check` PASS |
| 4 治理门 | `docs:check` 563 PASS、`hygiene` PASS、`quality:types` 0、`knip` 330 键零改动、`css-modules` PASS、`gate:code-size` PASS（合法下调重打） |
| 5 六件套 | 本 plan / roadmap / handoff / AUDIT-LOG / UI-702 同段追加 / DOC-REGISTRY 同批；`docs:reconcile` 0 issues |

**收口门禁**：`npm run closeout -- --skip=tests,quality:perf,quality:lint,quality:lint:ledger --gate ...` → **23/23 门 PASS**。4 门显式排除且均未通过、不算 PASS：`tests`（P6/W5a/keychain/并发测试 W/V 红，沿用 D1 归因）、`quality:perf`（V/环境稳定红）、`quality:lint` 与 `lint:ledger`（并发写入者 W 文件 1 项 `no-unused-vars`）。证据=`acceptance/ui-design-assessment-2026-11-11/d3/gate-readout.json`。

**六维自评与自纠**：①契约一致性=token 语义与门双向对账；②单一真相=hover/selected/surface-dim 各 1 真源；③失败语义=门 fail-closed + 只减棘轮；④测试有效性=9 项植入必红且门首跑 FAIL 70 项真实验证；⑤边界=WIP 零触碰、U/E 不代答、code-size 不放宽；⑥死代码=无；⑦最小化=零新增依赖。**自纠四处**：门自身口径（别名链继承/accent-hover 独立/剥注释）、accent 棘轮抓真（改引用派生 token）、code-size 初版会抬高锚点（改字节中性方案 + 冻结清单）、UI 台账同段追加不新增债。无 P1 遗留。

**`code-size --write` 合规判定**：脚本设计「有意变更必须显式重打」，红线禁止的是抬高允许上限。本包先把所有入册文件行数/字节压到 ≤ 基线，再 `--write`：6 个文件 bytes 锚点下降 3–39 字节、行数持平、WIP 条目零变化 ⇒ 真实收敛后的合法下调。若首版直接 `--write` 会把 `custom.css` 行数 1301→1312、字节 +767 写进基线，那才是放宽，已避免。

**未闭合项（D5 终态化）**：3 处裸 z 因字节棘轮保留（`Z_TIER_FROZEN` 只减清单，owner 收口后独立切片迁移）、WIP 文件 128 处 `;;` / 26 裸 z / 39 fallback（W）、10 个组件 CSS 外溢 token 定义回 `styles/`（需明暗成对 + 观感签字）、暗色 hover 与 selected 观感（`pending_human_eye`）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
