---
capability: block-417-ui-design-d2-layout
status: completed
goal: 布局单源与响应式统一的可机械判据与证据链；W 类在制 CSS 零触碰并逐件登记归属。
acceptance:
  - JS/CSS 断点阈值单一真源，767 vs 768 对齐且由机械门对账
  - 布局定义唯一性静态门：植入同类名容器第二定义必红，WIP 文件内既存重复显式登记 owner
  - 四块几何 / ≤900px / 长内容三态有实机证据或如实标 external-blocked
  - 零新增依赖、零触碰 WIP CSS、零放宽基线
---

# UI-D2 · 布局单源与响应式统一（BLOCK-417）

> **裁决来源**：用户 2026-11-11 预授权连续工作（D0/D1 同裁决，留痕于 `baseline.json.plan.ruling`）。
> **truthDomain**：`block-417-ui-design-d2-layout`（层 1 唯一占用；D1 已 completed 转空）。
> **形态自检**：把「布局单源」落成可复跑机械门 + 证据链，不做一次性视觉精修；WIP 文件零触碰、owner 归属可读，不靠改台账/改基线过门。

## 1. 范围（按文件切片，一切片一会话）

- **切片 A（本会话 · 可开工）**：`frontend/src/lib/uiBreakpoints.ts` 单一真源常量；`frontend/src/hooks/useWorkspacePanels.ts`、`useWorkspaceLayout.ts`、`titlebar/shared.tsx` 的裸 `matchMedia` 阈值改为引用常量并对齐 768；`scripts/ui-design-breakpoints.mjs` + `gate:ui-breakpoints` 机械门（JS 禁裸阈值、CSS 阈值须在登记表、WIP 文件阈值显式登记 owner、植入未登记阈值必红）；`test/ui-design-breakpoints.test.mjs` 负测。
- **切片 B（本会话 · 可开工）**：`scripts/ui-design-layout-gate.mjs` + `gate:ui-layout` 布局定义唯一性门（同类名容器规则 >1 处即报告；非 WIP 文件出现第二定义必红；WIP 文件既存 2 处 `.workspaceSessionLayout` 定义显式登记为 W 归属、不代改）；`test/ui-design-layout-gate.test.mjs` 负测。
- **切片 C（实机腿）**：9223 离屏实例做四块几何（无重叠 / 同行同宽 / 不溢出父容器 / 祖先右缘 ≤ 可视列）、≤900px 不越界、长内容三态、元素级裁剪截图；一律不设 `PETRI_TEST_ONSCREEN`，跑完立即终止实例；不可达则 `external-blocked` + 补腿条件。

## 2. 非范围 / W 归属（硬红线）

| 文件 / 项 | 归属 | 处置 |
| --- | --- | --- |
| `frontend/src/pages/project-workspace.module.css`（开局 M 11+/9−，BLOCK-395 B-11） | 他方在制 WIP | **零触碰**：`CenterPanel` 双层 layout → 独立 `XxxLayout.module.css`、`:1546/:2847` 同名 class 合并、该文件内断点（700/860/960/520/640）与 `@container` 双判据统一、`;;` 与 z-index 收敛均不代改；逐件登记 owner 与补腿条件，D5 终态化 |
| 17 档收敛到 ≤4 档 | U-04 `pending_user_ruling` | 不改产品响应式档位语义；只做单源与 767/768 对齐（报告 §3 D2 明确范围） |
| `src/main/_backend-ports.js` + `test/block414-backend-port-reuse.test.mjs` | 开局后并发写入者在制 | 零触碰 |
| 用户 untracked 资产（10 项） | 用户资产 | 零触碰、零 stage、零提交 |

**判「补丁 vs 重构」**：D2 主体是新建判据面与常量抽取（纯重构，零行为变化），按 BLOCK-92 拆前拆后同套绿；767→768 是报告明确要求的 1px 阈值对齐（非叠加修复），同步更新受影响的 matchMedia stub 测试。未在任何既有抽象上叠加条件。

## 3. 依赖与证据位置

| 项 | 位置 |
| --- | --- |
| 尺子 | `docs/ui-design-acceptance-checklist-v1.md` §2/§3/§4 |
| 单一真源 | `frontend/src/lib/uiBreakpoints.ts`、`scripts/ui-design-breakpoints.mjs` 登记表 |
| 机械门 | `gate:ui-breakpoints` / `gate:ui-layout` + 两份契约测试 |
| 实机 | `acceptance/ui-design-assessment-2026-11-11/d2/`（几何 JSON / PNG / `screenshot_unavailable` 标记） |
| U/W 材料 | `docs/ui-design-ia-decision-material.md`（U-04/W）、本 plan §2 |

## 4. 验收门禁（收口逐项对账）

1. `gate:ui-breakpoints` + `gate:ui-layout` PASS，负测覆盖植入未登记阈值 / 裸 JS 阈值 / 同类名第二定义 / 登记表篡改 / W 例外越界 5 类。
2. 拆前拆后同套绿：`frontend` 受影响测试（titlebar / useWorkspacePanels / useWorkspaceLayout / extensions）+ `theme-token-contract` 19/19。
3. `docs:check` / `hygiene:check` / `quality:types` / `quality:lint` / `ui:audit:check` / `gate:ui-entries` / `gate:ui-baseline`。
4. 四块几何 + 长内容三态：实机证据或 `external-blocked` 如实标注；DOM 几何不冒充人眼观感。
5. canonical 六件套回写 + `docs:reconcile` 0 issues + `docs:check` PASS。

## 5. U / E / V / W

- U-04（档位数）、U-06（页头形态）沿用 `docs/ui-design-ia-decision-material.md`，不改默认语义。
- E：元素级截图过目、暗色观感、读屏 → `pending_human_eye`，签字槽在册。
- V：9223 CDP 不可达 / 截图失败 → `external-blocked` / `screenshot_unavailable`。
- W：见 §2。

## 6. 收口笔录（2026-11-11 · COMPLETED，带 done-partial）

| §4 判据 | 当次证据 |
| --- | --- |
| 1 两门 + 5 类负测 | `gate:ui-breakpoints` PASS（104 CSS / 18 档非 WIP 阈值 / JS 裸阈值 0 / 767→768 对齐）；`gate:ui-layout` PASS（3135 定义 / 104 文件 / WIP 2 组重复登记 owner / 热点 708 只减棘轮）；负测 13/13（未登记 CSS 阈值 / JS 裸阈值 / 767 残留 / TS 常量漂移 / 对齐值缺失 / 第二布局定义 / WIP 新重复 / WIP 重复增长 / 缺 owner / 热点新增 / WIP 例外越界） |
| 2 拆前拆后同套绿 | 受影响前端 6 文件 78/78（含 D1 同套 69 项 + `useWorkspaceLayout` 9 项）、theme 19/19、Jev 建议同域等价 `block59-window-manager` 43/43 |
| 3 治理门 | `docs:check` 562 PASS、`hygiene:check` PASS、`ui:audit:check` PASS、`quality:types` 0、`quality:arch` PASS、`quality:knip:check` PASS（保留面 330 键零改动）、`live-window-policy` 1/1；`gate:ui-entries` / `gate:ui-baseline` 未回退 |
| 4 实机 | `ui-d2-geometry-live` 9223 离屏 9/9 allPass（跑完立即 kill，REMAIN=0，未设 `PETRI_TEST_ONSCREEN`），证据 JSON + PNG 落 `d2/`；**诚实降级见 §6.1** |
| 5 六件套 | 本 plan / roadmap / handoff / AUDIT-LOG / UI-702 同段追加 / DOC-REGISTRY 同批；`docs:reconcile` 0 issues + `docs:check` PASS |

### 6.1 实机证据的诚实降级（DOM 几何 ≠ 视觉验收）

9223 首跑（实例未启）0/1 落 `external-blocked`；启动离屏实例后 9/9 allPass。但：探针在欢迎页 `body` fallback 上量测（chain=1，未命中真实 `.workspaceSessionLayout`），G1/G2 只证非零几何；G3/G4/L2/L3 在 fallback host 上成立（right=1600 / viewport=1600）；≤900px **未做 CDP Emulation 真缩放**（当前视口 1600，不冒充窄视口通过）；截图为全页 PNG（119399B）**非元素级裁剪**。故「四块几何全绿 / 长内容三态 / 元素级截图过目」判 **done-partial**，人眼项保持 `pending_human_eye`，路线与签字槽在 `docs/ui-design-ia-decision-material.md` §6。

### 6.2 六维自评与自纠

①契约一致性=TS 常量与 CSS 阈值由门对账；②单一真相=`uiBreakpoints.ts` 唯一 JS 真源、`STANDALONE` 与 D1 同源；③失败语义=两门 fail-closed + 只减棘轮；④测试有效性=13 项植入必红且经首跑 FAIL 验证；⑤边界=WIP 零触碰、U-04 不代答、离屏纪律；⑥死代码=knip 新导出与动态入口两处**根修**（删零消费导出 + `knip.json` 精确登记，**未 `--update` 放宽基线**，保留面 330 键零改动）；⑦最小化=零新增依赖。**自纠三处**：(a) 断点正则误把普通 `max-width: 320px` 属性当断点（85 项假红）→ 只认 `@media/@container` 条件；(b) 布局门把状态变体/响应式覆盖/注释类名算重复（1000+ 假红）→ 改「可视区布局类单源 + 全仓热点只减棘轮」，同口径重算基线 804→708（不缩分母）；(c) WIP 登记按真实行数补齐 `workspaceSessionFrame` 3 处。无 P1 遗留。

**收口门禁**：`npm run closeout -- --skip=tests,quality:perf,quality:lint,quality:lint:ledger --gate ...` → **21/21 门 PASS**。4 门被显式排除且均未通过、不算 PASS：`tests`（P6/W5a/keychain/并发测试 W/V 红，沿用 D1 归因）、`quality:perf`（V/环境稳定红）、`quality:lint` 与 `lint:ledger`（并发写入者 W 文件 1 项 `no-unused-vars`）。证据=`acceptance/ui-design-assessment-2026-11-11/d2/gate-readout.json`。

**未闭合项（D5 终态化）**：真实工作区四块几何 + ≤900px 真缩放 + 元素级裁剪截图（`done-partial` / `pending_human_eye`）；WIP CSS 内 CenterPanel 布局抽离与同名 class 合并（W，零触碰）；17 档→≤4 档（U-04 `pending_user_ruling`）；@media/@container 双判据统一（W）。

## 7. 完成语义

§4 五条逐项有当次证据，未达项按 §5 终态化、不计入完成数；门禁全绿是必要非充分条件。

G0 开发期常态 · 不外推 packaged/Provider/GA。
