# BLOCK-62 — TitleBar 列体化：三列 header 与内容一体化，消灭跨 DOM 树宽度同步

- Plan ID：`BLOCK-62-TITLEBAR-COLUMNIZATION`
- 状态：completed（2026-09-07 用户裁决「按这个方案开始重构，先做拖拽接缝的 spike 验证」→ spike PASS → P0/P1a/P1b/P2 同日落地 → P3 用户实机验收通过收口）
- 前置：UI-305-FRONTEND-LARGE-FILE-REFACTOR 让位（仅立项文档 `ab65f4e6`，无实现提交，让位零损失；恢复需本包收口后用户裁决）
- 关联：BLOCK-59（窗口系统已收口，pop-out 路由 `/window/*` 不走 AppShell，本包不动其证据面）；UI-309 两轮修复为本包铺垫（P2 实测收敛：context 宽度推送退役，live 变量保留作同树指针跟随）
- 纪律：G0 开发期常态 · 不外推 packaged/Provider/GA

## 1. 问题定位

TitleBar 是独立于工作区的整宽横条（`position: fixed`，[TitleBar.module.css](../frontend/src/components/desktop/TitleBar.module.css) L21-36），用 `grid-template-columns: 左span 1fr 右span` **模拟**下方三栏列宽。顶栏分隔线与栏体边缘分属两棵 DOM 树，只能靠同步对齐：

- 同步链 v1：`leftWidth` state → `updateTitleBar` → `--titlebar-*-span`（React 提交晚一拍 → 拖动脱节，UI-309 主修）
- 同步链 v2：拖动期 `--petri-live-*` CSS 变量直写（UI-309 加映）
- 同步链 v3：拖动标记禁 transition + `:global` 复活（UI-309 加映二次）

每一环都是延迟面。结构性修复 = 让顶栏片段与栏内容**在同一容器内**，宽度由列容器自身决定，同步契约整体退役。

## 2. Spike 证据（2026-09-07，手动 ground truth）

`/tmp/drag-seam-spike.html`（三列相邻 drag 矩形 + 1px gap 负对照 + 动态改宽）：

- **相邻无缝 → 接缝全覆盖可拖**（T1/T2 按下均被原生吞掉，无穿透记录）
- **动态改宽 240→600 后新接缝即时生效**（T4 正常）
- **1px gap 产生死缝**（T5 按下穿透记录 = 负对照成立）
- 结论：列体化 drag 面无障碍；**工程纪律：列间不得留 gap，1px resize rail 必须归入某列 drag 区**
- 方法论留痕：CDP 合成事件绕过原生拖拽路径（drag 区不穿透也不触发窗口移动），窗口拖拽类验证必须手动或原生事件；CGEvent 注入在沙箱内不可用（-25211）

## 3. 设计裁决

### 3.1 布局形态

```
现在：  [ TitleBar fixed 整宽 h=38 ]
        [ leftCol | center | rightCol ]（paddingTop:38 补偿）

目标：  [ leftCol: headerL(38) + body ] [ center: headerC(38) + body ] [ rightCol: headerR(38) + body ]
        三列 flex 行容器占满 100vh，列宽即顶栏宽——天然一体，无同步
```

- 外层：`display: flex` 行容器（替换 App.tsx `paddingTop` + fixed 方案），列间 1px rail **并入左邻列**（drag 连续，遵守 spike 纪律）
- 列收起：header 片段随列 DOM 移除；收起态按钮（左栏 toggle 等）常驻中栏 header 左缘，不再依赖 collapsedRail 魔数
- 底部 1px 分隔线：各列 header 各自 `border-bottom`，相邻列同色 → 视觉连续一根线

### 3.1.1 P0 布局实现细节（调查暴露的约束，避免下轮重推）

- **workspaceRoot 占满视口**：workspace 路由时 AppShell `main` 的 `paddingTop` 置 0，`.workspaceRoot` 从 `calc(100vh - titlebar)` 改 `100vh`（App.tsx 按路由分流：`/project/:id/*` 且非 `/results` 才走列体化壳；home/skills/review/result-studio 保持 fixed 顶栏 + 各自 `calc(100vh - titlebar)` 不动）。
- **banner/notice/error 必须脱离流**：现状是 `.workspaceBody` 的前置兄弟（占流）。列体化后若保留占流，会把列内 absolute header 顶下去（顶栏不在视口最顶）。改 `position: absolute; top: 38px; left:0; right:0; z-index` 低于顶栏，覆盖在列 body 之上、header 之下——视觉与现状一致。
- **每列 = relative 容器 + absolute header-slot + body**：列容器 `position: relative`；header-slot `position:absolute; top:0; left:0; right:0; height:38`（撑满列宽 → 宽度天然与 body 同步，这是消灭同步的机制）；body `padding-top:38` 避让。rail（`.resizeHandleV` 9px 负 margin）移入左列 wrap 全高，遵守 spike 纪律（rail 归列 drag 区）。
- **Panel width 归属上移**：`LeftPanel`/`RightPanel` 现在组件内自设 `width: ctx.width`；列体化要把 width 上移到列 wrap，Panel 根改 `width:100%`。P0 需触碰两 Panel 根 style（这是 P0 唯一侵入组件内部处）。
- **P0 期间 header-slot 留空**，fixed 整条 TitleBar 仍覆盖顶部（视觉零变化、可整体回退）；P1 才把整条 TitleBar 内容迁入三段、删 fixed 条与 `--titlebar-*-span`。

### 3.2 组件拆分（纯呈现层重组，数据契约不动）

| 片段 | 内容 | 归属列 |
|---|---|---|
| `TitleBarLeft` | 自绘交通灯（mac 三圆点 / win 右侧无）+ 左栏 toggle | leftCol header |
| `TitleBarCenter` | 标题 + 分支 tabs + 会话选择器 + 结果选择器 + 摘要 toggle + 收起态左栏 toggle | center header |
| `TitleBarRight` | tabs pills + 「+」工具菜单 + 右栏 toggle +（win/linux）WindowControls | rightCol header |

- 数据源：继续走 `useWorkspacePanels` 的 `titleBar` state（**不新建第二真相**）；project-workspace 注册 effect 删除 `leftPanelWidth/rightPanelWidth` 两字段（宽度不再需要跨树同步），其余交互回调原样保留
- `TitleBar.tsx`（603 行）拆为 `desktop/titlebar/` 下三片段 + 共享 hooks（菜单开合/结果选择器逻辑提取，不重写）；`TitleBar.module.css` 按片段拆三个 module.css
- 退役清单：`--titlebar-left-span/--titlebar-right-span`、`--petri-live-left/right-width|span`、TitleBar.tsx `collapsedLeftRail/collapsedRightRail`（180/146/80/196 魔数）、`titleBarStyle` 注入、useResizableColumns 拖动期变量写入（transition:none 规则保留——展开/收起仍受益）

### 3.3 drag 带

- 三列 header 各自 `-webkit-app-region: drag`，rail 归左列 → spike 证明无缝
- 交互元素 no-drag 洞随片段迁移（交通灯/选择器/菜单/tabs）
- 双击最大化（非 mac）：三个 header 片段各自挂 handler

### 3.4 边界

- 不动：主进程窗口管理（frame:false 维持）、BLOCK-59 pop-out 路由（本就无 TitleBar）、BottomTerminal（其 left/right offset 改由列容器几何派生或保持现状，P1 实测裁决）、工作区业务逻辑
- 不做：视觉重设计（颜色/高度/字号零变化）、Provider/GA/G1+ 事项

## 4. 阶段（串行）

- **P0 布局壳**：App.tsx / project-workspace 改三列纵向容器，rail 归列，paddingTop 链退役；TitleBar 暂整体绝对定位占中栏（可回退中间态）
- **P1 片段拆分**：三片段组件化 + CSS 分模块 + no-drag 洞迁移 + 双击/交通灯行为逐项目测
- **P2 同步链退役**：删 live 变量 / span 推送 / 魔数；TitleBarState 宽度字段移除；useResizableColumns 清理
- **P3 收口**：测试迁移（TitleBar.test.tsx 15 用例按片段重组）+ 实机矩阵 + 台账 + 门禁

## 5. 验收门禁

- 定向：titlebar 三片段 + useWorkspacePanels + useResizableColumns + LeftPanel/RightPanel vitest；tsc 0
- 实机（dev Electron CDP + 手动双通道）：
  1. 拖动左右 rail：顶栏线与栏边**物理同一容器**，任意时刻无脱节（帧对齐 gap=0）
  2. 窗口拖拽：三列 header 任意点 + 接缝处均可拖（手动复测 spike 点位）
  3. 交通灯：关闭/最小化/全屏可用；左栏收起后仍可点
  4. 「+」工具菜单 / tabs pills / 结果选择器 / 会话选择器 / 摘要 toggle 行为与 HEAD 基线一致
  5. 列收起/展开动画无跳变；win/linux WindowControls 不回归（非 mac 分支代码路径过目）
- 治理：docs:check + ui:audit:check（UI-310 新条目）+ docs:reconcile

## 6. 风险与缓解

- **收起态按钮归属变更**是用户可感知的交互变化（左栏收起时 toggle 位置）→ P1 实机过目，不满意可回退到「收起时 header 片段保留 32px 轨」方案
- **fixed→流式布局**影响浮层定位（toolMenu/下拉的坐标基准）→ 菜单仍 fixed 定位挂 body 层，P1 逐项核对
- **BottomTerminal offset** 依赖 live 变量 → P2 前保持现状，P2 时改由列容器实测几何（或保留 offset 变量仅终端消费，范围最小化）
- 大 diff 风险：分阶段小提交，每阶段可独立回退

## 7. 进度记录

- 2026-09-07 立项（用户裁决启动；spike PASS 同日完成于立项前）；UI-305 让位登记
- 2026-09-07 **P0 地基完成**（最小可回退）：App.tsx 按路由分流 `main` paddingTop（列体化路由 0 / 其余 38，归一化尾斜杠正则排除 `/results`）+ `.workspaceRoot` 改 `100vh + padding-top:38`（box-sizing 保内容区不变）。**未建 header-slot、未动 fixed TitleBar**——视觉与现状零差异，可整体回退。验证：tsc 0 / TitleBar+useResizableColumns vitest 31/31 / CDP 几何 workspace `main padTop=0·rootH=100vh·bodyTop=38·列高=100vh−38`、`/skills` 保持 38。顺带发现并登记 `/results` 既有崩溃（AUDIT-LOG 🟢，非本包引入，stash 验证）。提交 `dd4740dc`。
- 2026-09-07 **P1a 行为保持提取完成**：TitleBar.tsx（603 行）三区内容 + 共享逻辑提取到 `titlebar/` 容器无关片段（shared/LeftZone/CenterZone/RightZone），TitleBar 收敛为 fixed 薄壳。唯一必要修正：双击改用不订阅 maximize 的纯 `handleTitleBarDoubleClick`（避免与交通灯片段双份 `onMaximizeChanged`）。tsc 0 / TitleBar.test 15/15 / 定向 47/47 / CDP fixed 条 8 控件全在位 seamGap=0。提交 `1995a598`。
- 2026-09-07 **P1b 列内 header 结构翻转完成**：`ColumnHeader(side)` 作为各栏 flex-column 第一子元素（交叉轴 stretch → 宽=栏宽，同一元素派生同帧 → 刚性由构造保证）；收起态内联进中列 header（无 collapsedRail 魔数）；App 列体化路由不渲染全局条、ProjectWorkspace 自持顶栏（regular=列内 header / compact+早退=fixed 条，互斥无双条）；leftPanelWrap/resultPanel height:100%→flex:1（实测溢出归零）。实机（证据 `acceptance/ui-310/columnized-headers.png`）：拖拽 +70/+150 gap=0、「+」菜单不裁、收起态交通灯可达、compact 854px fixed 回归。tsc 0 / 定向 53/53 / 门禁 PASS。提交 `b2207a3d`。
- **实施记录（P1b 教训）**：结构方案在 wrapper / aside-child / absolute 间反复漂移，靠 `git checkout` 回退到 P1a 检查点后一次性连贯完成——印证 §6「分阶段小提交」纪律；aside-child 胜出的决定性论据=aside 已消费 `--petri-live-*`，header 交叉轴 stretch 即栏宽（同元素派生，无需再传宽）。
- **下一步 P2**：同步链退役——`--petri-live-*`（列体化路由内 header 已不依赖，但栏体 aside 仍消费 → 改为 plain state 同 commit）、fixed 条 `--titlebar-*-span` grid 模拟、`updateTitleBar` 宽度两字段、BottomTerminal offset 改列容器几何；P3 收口转 verified。
- 2026-09-07 **P2 跨树同步链退役完成（范围经探针实测收敛，与初版计划的差异如实登记）**：**退役** ① `TitleBarState.leftPanelWidth/rightPanelWidth` + 每拖拽帧 `updateTitleBar` 跨树推送（regular 不消费宽度=死链+无谓 churn）→ fixed 条宽度改 props 同树直传（`TitleBarProps`，compact 渲染点传真实宽）；② fixed 条 grid 三处 `var(--petri-live-*-span)` 死兜底（fixed 条只在 compact/非工作区渲染，拖拽禁用、span 永不写入）。**保留（计划偏差）**：`--petri-live-*-width/-span` 实时变量与 collapsedRail 常量——探针证实 live 变量角色已从「跨树同步补丁」转为「aside 本体+终端的同树指针跟随」（删除会让 aside 本身退回每帧 commit 一拍滞后，是回归）；collapsedRail 供 fixed 条 compact/收起态。BottomTerminal offset 维持 live-span 消费（同树跟随，合法）。实机：regular gap=0 不回归 / compact 浮层 alignGap=1（rail 归属设计值）/ skills 默认宽不回归 / 零异常；tsc 0 / 定向 53/53 / 门禁 PASS。证据 `acceptance/ui-310/p2-sync-chain-retired.png`。
- 2026-09-07 **P3 收口 completed**：用户实机验收通过（拖拽顶栏线与栏边一根线实时移动 / 收起态交通灯与工具开关内联可达 / 「+」等菜单展开正常 / 缩窗 ≤960 回退整条顶栏 / 三段顶栏任意处可拖窗口），指示「收口 并 push」。提交链 `dd4740dc`(P0) → `1995a598`(P1a) → `b2207a3d`(P1b) → `fefc6942`(P2)。UI-310 转 verified（证据 `acceptance/ui-310/`）；roadmap active 槽清空、UI-305 恢复候选（启动需用户裁决）。收口门禁：docs:reconcile + docs:check + ui:audit:check。
- **遗留候选（不阻塞收口，登记待裁决）**：① `--petri-live-*` 变量与 collapsedRail 常量仍在（P2 实测证明它们是「同树指针跟随」与「fixed 条 compact/收起态」的合法机制，非死链，保留）；② `/project/:id/results` 既有崩溃（AUDIT-LOG 🟢，ResultStudio experimental 面，需单独立项）；③ UI-305 前端巨型组件拆分（本包让位方，恢复需用户裁决）。
