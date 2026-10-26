---
capability: unified-pane-model
goal: C-41（E1 跨宿主渲染合并）与 C-42（通用 pane 模型 + 终端分屏余项）的设计包合册：产出可评审的统一 pane 模型设计与分阶段迁移计划；不做实现（实现按本设计另发令）。
acceptance:
  - 现状测绘：中心模式/底部终端/侧聊/右轨四宿主的渲染树、挂载点、状态源逐一切图（文件:行级）。
  - 统一 pane 模型：类型/生命周期/布局约束/持久化/键盘路由的数据契约，与既有 useWorkSurfaceTabs 状态机的映射关系明确（不推翻既有，只收敛）。
  - 迁移分阶段：每阶段可独立验收、可回退；BLOCK-257 已交付的 E9 双 pane 与 F7 最大化作为既有事实纳入（不重复设计）。
  - 非范围明确：不做实现、不动 SimpleChat 主链、不引入布局引擎依赖。
reopen: 实现（另发令）；拖拽比例调节的指针交互细则；会话恢复的 pane 快照序列化。
status: completed
---

# 设计合册 · C-41 E1 跨宿主渲染合并 + C-42 通用 pane 模型（BLOCK-264 承载）

backlog 判定：C-41/C-42 均标注「先出设计包再谈实现」——本文件即该设计包。两题同根（宿主碎片化），合册设计、分头实现。

## 1. 现状测绘（2026-10-25 实码切图）

| 宿主 | 渲染树根 | 挂载点 | 状态源 | 现状问题 |
| --- | --- | --- | --- | --- |
| 中心工作面 | `CenterPanel` | `project-workspace.tsx` 主体 | `useWorkSurfaceTabs`（tab 状态机，BLOCK-250 已修 memo） | 模式切换（chat/result/code/compare/history/scheduled）已统一在此 |
| 底部终端 | `BottomTerminal` | 同页底栏 | `useTerminalTabs`（BLOCK-257 E9 已支持 secondary 双 pane） | 与中心面无统一 pane 语义（独立分屏逻辑） |
| 侧聊 | `SideChatDock` | overlay 挂载 | 组件内 open state（AUDIT-LOG 在册：开态被重挂吃掉） | 状态源在组件内=会重挂丢失（BLOCK-246 实机观察） |
| 右轨 | `RightPanel` | 同页右栏 | `useWorkspacePanels` | 与侧聊平行的另一套开关语义 |

已有收敛事实（不推翻）：BLOCK-253/257 的「更多工具」菜单已做**入口统一**（portal 修复后可重复弹出）；E9 双 pane 与 F7 最大化已交付。缺口=**模型统一**：四宿主各自为政的 pane 生命周期/持久化/键盘路由。

## 2. 统一 pane 模型（数据契约）

```ts
interface WorkspacePane {
  id: string;                    // 稳定 id（持久化键）
  kind: 'center' | 'terminal' | 'side-chat' | 'right-rail';
  // 布局约束：中心不可关；terminal/side-chat/right-rail 可开合
  closable: boolean;
  // 持久化：会话恢复只存 {id, kind, open, size?}——内容态留在各宿主自己的 store
  open: boolean;
  size?: { preset: 'half' | 'maximized' | 'restored'; ratio?: number };
}

interface PaneLayoutState {
  panes: WorkspacePane[];        // 集合幂等；顺序即 tab 栏顺序
  focusedPaneId: string | null;  // 键盘路由目标（Cmd+W 关当前、Cmd+1..9 切换）
}
```

**关键决策**：
1. **单一状态源**：`useWorkspacePanels` 升级为 pane 布局唯一源（它已是右轨/面板的事实源，升级而非新建）；`SideChatDock.open` 提升进来（解 BLOCK-246 在册问题）；`useTerminalTabs` 的分屏态映射为 terminal pane 的 `size.preset`（不吞它的 tab 内部态）。
2. **宿主渲染树不动**：各宿主继续渲染自己的内容——模型只统一「开合/尺寸/焦点/持久化」四件事；这是最小收敛面（重渲染治理刚在 BLOCK-250 收口，不重开大改）。
3. **持久化**：`PaneLayoutState` 走 user-prefs 族新键 `paneLayout`（schema 登记，读写单一实现）；恢复=启动时读一次，不做热同步。

## 3. 分阶段迁移（每阶段独立验收、可回退）

| 阶段 | 内容 | 验收 | 回退 |
| --- | --- | --- | --- |
| P1 | `paneLayout` schema 键 + `useWorkspacePanels` 升级为布局源（side-chat open 提升） | SideChatDock 开态不再被重挂吃掉（在册 AUDIT 项销）；prefCache 漂移门绿 | 状态回落组件内（一行开关） |
| P2 | terminal pane 映射（E9 双 pane 的 active/secondary 映射进 size.preset） | 既有 E9 测试全绿不改语义；新增布局持久化往返测 | 映射层可整体摘除（terminal 状态自治如旧） |
| P3 | 键盘路由（Cmd+W/Cmd+数字按 focusedPaneId 分发） | 快捷键注册表（keymap 族）单测；焦点丢失回落 center | 路由层独立可摘 |
| P4 | 会话恢复（启动读 paneLayout） | 重启后 pane 开合/尺寸还原实机断言 | 不读即不恢复（零行为变化） |

## 4. 非范围

- 不做实现（本文件只是设计；实现另发令按 P1–P4）。
- 不动 SimpleChat 主链与 CenterPanel 模式状态机（BLOCK-250 刚收口的 memo 语义保持）。
- 不引入布局引擎/dock 库依赖（DEPENDENCY-CHECKLIST 默认 no）。
- 拖拽比例的指针交互细则、多显示器布局——留实现阶段细化。
