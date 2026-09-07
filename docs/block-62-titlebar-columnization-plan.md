# BLOCK-62 — TitleBar 列体化：三列 header 与内容一体化，消灭跨 DOM 树宽度同步

- Plan ID：`BLOCK-62-TITLEBAR-COLUMNIZATION`
- 状态：active（2026-09-07 用户裁决「按这个方案开始重构，先做拖拽接缝的 spike 验证」→ spike PASS → 启动）
- 前置：UI-305-FRONTEND-LARGE-FILE-REFACTOR 让位（仅立项文档 `ab65f4e6`，无实现提交，让位零损失；恢复需本包收口后用户裁决）
- 关联：BLOCK-59（窗口系统已收口，pop-out 路由 `/window/*` 不走 AppShell，本包不动其证据面）；UI-309 两轮修复为本包铺垫（live 变量机制在 P2 后退役）
- 纪律：G0 开发期常态 · 不外推 packaged/Provider/GA

## 1. 问题定位

TitleBar 是独立于工作区的整宽横条（`position: fixed`，[TitleBar.module.css](../frontend/src/components/desktop/TitleBar.module.css) L21-36），用 `grid-template-columns: 左span 1fr 右span` **模拟**下方三栏列宽。顶栏分隔线与栏体边缘分属两棵 DOM 树，只能靠同步对齐：

- 同步链 v1：`leftWidth` state → `updateTitleBar` → `--titlebar-*-span`（React 提交晚一拍 → 拖动脱节，UI-309 主修）
- 同步链 v2：拖动期 `--gewu-live-*` CSS 变量直写（UI-309 加映）
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

### 3.2 组件拆分（纯呈现层重组，数据契约不动）

| 片段 | 内容 | 归属列 |
|---|---|---|
| `TitleBarLeft` | 自绘交通灯（mac 三圆点 / win 右侧无）+ 左栏 toggle | leftCol header |
| `TitleBarCenter` | 标题 + 分支 tabs + 会话选择器 + 结果选择器 + 摘要 toggle + 收起态左栏 toggle | center header |
| `TitleBarRight` | tabs pills + 「+」工具菜单 + 右栏 toggle +（win/linux）WindowControls | rightCol header |

- 数据源：继续走 `useWorkspacePanels` 的 `titleBar` state（**不新建第二真相**）；project-workspace 注册 effect 删除 `leftPanelWidth/rightPanelWidth` 两字段（宽度不再需要跨树同步），其余交互回调原样保留
- `TitleBar.tsx`（603 行）拆为 `desktop/titlebar/` 下三片段 + 共享 hooks（菜单开合/结果选择器逻辑提取，不重写）；`TitleBar.module.css` 按片段拆三个 module.css
- 退役清单：`--titlebar-left-span/--titlebar-right-span`、`--gewu-live-left/right-width|span`、TitleBar.tsx `collapsedLeftRail/collapsedRightRail`（180/146/80/196 魔数）、`titleBarStyle` 注入、useResizableColumns 拖动期变量写入（transition:none 规则保留——展开/收起仍受益）

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
