# 阶段二备料：Orca 布局整体复刻方案框架（待 owner 触发，零代码）

> 触发条件：阶段一（owner 发 y12.7 聚焦态顶栏截图 → 像素差一次修正）后 owner 仍不满意。
> owner 口令（msg_4571f0c79a75）：「如果还不行 就改成和 orca 一样的布局？」
> 核真来源：Orca app.asar（Electron 同栈）已实证 `titleBarStyle: darwin ? 'hiddenInset' : ...` + `trafficLightPosition:{x:16,y:12}`（固定值配 Orca 自身几何）；当前 Petri 已用 hiddenInset + Petri 专属固定值 {x:20,y:12.7}。

## 目标形态（Orca 像素级模板）

深色**单层**顶栏：原生红绿灯悬浮 + app 名 + tab 行 + 导航按钮**全部融于一根深色条**；内容从顶栏**下缘**开始（不再走"内容铺到灯下"的 hiddenInset 路线）。

## 与当前路线的差异

| 维度 | 当前（hiddenInset 融合） | 阶段二（Orca 整体复刻） |
|---|---|---|
| 内容起点 | y=0（铺到标题条区、灯浮于内容上层） | 顶栏下缘（约 38px），内容不进标题条区 |
| 顶栏形态 | 各列独立 ColumnHeader（左/中/右三段） | 单一整条深色顶栏，元素一体化 |
| 红绿灯 | trafficLightPosition 精调对齐工具行 | 固定值 + 整条栏统一布局（Orca 同款） |
| 对齐问题 | 灯（OS 层）vs 工具行（web 层）跨层难对齐 | 同层一体化，无跨层对齐问题 |

## 改动面清单（触发后逐项做）

1. `src/main/_window-create.js`：hiddenInset 保留或按 Orca 改 `titleBarStyle:'hiddenInset'` + 固定交通灯位（Orca {16,12} 或 Petri 适配值）。
2. `ColumnizedTitleBar.tsx` / `TitleBar.tsx`：把左/中/右三段列头合并为**单一整条**顶栏（app 名 + tab 行 + 导航钮 + 铃铛/更新），各列内容区从顶栏下缘起。
3. `ColumnizedTitleBar.module.css` / `TitleBar.module.css`：深色一体化背景（--petri-bg-surface）、单层高度、app-region drag/no-drag 按整条重新划分。
4. 三栏内容容器：`padding-top`/布局起点从 0 改为顶栏高度，避免内容压在顶栏下。
5. 状态机 `_fullscreen-state.js` 保留（native 全屏仍统一处理）。
6. HK-01：整条顶栏在场 / 元素一体化 / 内容起点在顶栏下缘 / drag+no-drag 分区 / 状态机保留。

## 验收口径（owner 实机）

对照 Orca 截图逐项：①深色单层顶栏视觉 ②红绿灯与元素同行不重叠 ③tab 行/导航钮/铃铛位置 ④内容不压顶栏 ⑤全屏进出/暗色兼容 ⑥owner 明确接受。

## 边界

- 阶段一像素差修正若成功，本框架不启动（存档备查）。
- 触发后属 UI 大改（多文件），按 HK-01 红绿 + 全静态门 + 绿批次推 + 需 owner 重启（main 改动）。
- owner 实例零触碰、观感零代签。
