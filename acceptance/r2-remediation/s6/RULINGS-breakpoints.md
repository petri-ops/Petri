# S6b 断点档位收敛 ≤4 · 裁决留痕（2026-11-21）

> 波次：R2 清偿批 S6b（P0-2）· 预置裁决 R4（机械盘点→分布聚类 ≤4 档→JS/CSS 单源→全量替换→行为基线同套绿）。

## R-S6b-1 盘点（2026-11-21 现读）

视口 @media 阈值非 WIP 20 档：96,420,520,560,577,640,679,680,700,720,760,768,820,960,996,997,1120,1146,1200,1380
（gate:ui-breakpoints 登记表 21 档含 WIP 面；JS 侧 matchMedia 裸阈值 0——UI-D2 已单源化）。

## R-S6b-2 聚类与锚点推导（档值来自盘点，不预设）

自然簇（按分布间隙）：{520,560,577} / {640,679,680,700,720,760,768} / {820,960,996,997} / {1120,1146,1200,1380}
——恰好 4 簇。锚点=簇内众数，且与既有 JS 单源冲突时单源优先：
- **520**（窄）：众数 520×3；吸收 560、577(min)
- **768**（手机）：众数 768×3+JS 单源 MOBILE_BREAKPOINT_PX；吸收 640,679,680,700,720,760
- **960**（紧凑）：JS 单源 COMPACT_BREAKPOINT_PX 优先于簇内众数 820×4（选 820 会破坏既有 JS/CSS 契约再造第二真相源）；吸收 820,996,997(min)
- **1200**（宽）：簇内四值各×1，取中位邻近整值 1200（navbar 查询既有值）；吸收 1120,1146,1380
- **划出**：96/420/679/720/1146 = @container 元素级查询（非视口档位，model3d-layout 契约锚 420/720 容器档保持）；project-workspace.module.css 5 档=BLOCK-395 B-11 他方 WIP 零触碰。

## R-S6b-3 执行

- 15 个 CSS 文件 24 处 @media 阈值替换（含 custom.css navbar 区间注释对齐 996→960/576→520）。
- `scripts/ui-design-breakpoints.mjs` REGISTERED_THRESHOLDS 21→12（只减棘轮合规：560/577/680/760/820/996/997/1120/1380 九档移除）。
- `uiBreakpoints.ts` 注释对齐（U-04 已执行；无消费档不加导出，knip 死导出禁）。
- 单源形态不变：JS=uiBreakpoints.ts 常量；CSS=@media 字面值 + gate 登记表机械对账（CSS var() 在 @media 不可用，形态约束见 UI-D2）。

## R-S6b-4 行为基线（改前改后同套）

同套=styles 全套 + model3d-layout + WorkflowRunsPanel + result-studio 全部 + desktop 全部 + welcome/home：
改前 632 passed / 3 failed（3 失败=S6a 契约测**自匹配假红**：提交后 git grep 可见自身源码，已修排除）→
改后 **635/635 全绿**；tsc 0；gate:ui-a11y PASS；gate:ui-breakpoints PASS（非 WIP 9 档在册）。

## 诚实边界

- 收敛=authorized breaking（U-04 预授权）：簇内边缘区间塌缩点平移（如 640–760→768 后，该区间内窗口不再提前塌缩）；
  @container 元素级自适应不受影响。
- WIP 面五档（520/640/700/860/960）待 BLOCK-395 owner 收口后并入四档，本批零触碰。
