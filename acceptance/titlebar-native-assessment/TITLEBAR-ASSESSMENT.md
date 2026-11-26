# 顶栏原生 vs 自绘对比评估（owner msg_58fcbd3c0f7f）

> 性质：对比评估材料，**零代码**；owner 拍板后才动。证据=git 考古 + 台账 + 当前代码。
> 视觉对照稿：`visual-comparison.html`（静态、浏览器直开、亮暗切换）。

## §1 考古：自绘起源与当时解决的问题

- **起源提交**：`c07d9caf3 feat(desktop): add verified frameless window controls (UI-120)`（2026-08-04）；更早 `a95a305e9 feat: stabilize Codex-style desktop workspace`（2026-07-11）已引入 `frame:false` 方向。
- **UI-120 台账原文**（`docs/ui-productization-audit.md:1615`）：原生方案当时的问题=①macOS `hiddenInset` 交通灯 + CSS 灰"井"承接，**视觉与 Cursor 一类"灰色圆角胶囊+深色 X/横线/方框"不一致**；②`frame:true` 让窗口控制和缩放后的 renderer chrome **分属两套几何**。当时裁决=`frame:false` + 三个 22px 自绘按钮接 sender-bound IPC，102+32px 轨道消除折叠溢出，maximize live event 优先于 query，fail-safe 投影；验收 TitleBar 11/11、Electron/preload 6/6、Darwin arm64 开发态实机（最大化/还原/最小化/双击隔离/Cmd+0/-/+/明暗/1050~720px AX/Cmd+M/W）。
- **后续修补**：2026-08-09「macOS 自绘交通灯补全」——`frame:false` 丢原生红绿灯、Mac 分支原只留占位→红绿灯双双消失，补自绘 close/min/max（同 UI-120 IPC 源）；待实机确认。
- **结论**：自绘不是随意选择，是为了**视觉统一 + 几何一致性**做出的裁决（对标 Codex/Cursor 形态）。恢复原生等于**推翻 UI-120 裁决**，需 owner 明确接受视觉回退。

## §2 现状盘点：自绘顶栏承载的自定义功能

| 功能 | 实现位置 | 实现/维护成本 |
|---|---|---|
| 自绘红绿灯（关闭/最小化/最大化） | `TitleBarLeftZone.tsx:31-55` + `src/main/_window-ipc.js` sender-bound IPC + fail-safe 投影 | 中：三按钮+IPC+live event 优先于 query+macOS 双分支；曾出"红绿灯消失"回归 |
| 可拖拽窗口区（app-region drag） | ColumnizedTitleBar 容器/轨道（102+32px） | 低-中：与三栏布局几何耦合，折叠溢出做过专修 |
| 通知中心铃铛（未读徽章） | `NotificationCenterBell.tsx` | 低-中：独立组件，可移到内容区（如状态栏）但需新位置裁决 |
| 更新提示胶囊 | `UpdatePill.tsx` | 低：可随铃铛迁移 |
| 审阅未审文件数徽章 | `TitleBarRightZone.tsx:137,176` | 低：与右栏 tab 同源，可只在右栏内显示 |
| 「更多工具」菜单（右栏 tab 入口 15→现 13 项+host 项） | `TitleBarRightZone.tsx:153-203` + `useWorkspaceTitleBar.ts` | 中：四组分组刚落地（UI-740），迁移需保留入口 |
| 侧聊/摘要/测试结果等生态入口 | 同上菜单 + 右栏 tab | 中：与右栏 IA 强耦合 |
| 测试实例徽标 `[TEST]` 前缀 | `ColumnizedTitleBar` + preload `additionalArguments` | 低：frameless 下任务栏/Alt-Tab 唯一线索；原生模式下由系统标题栏承担 |

## §3 今日回归背景（如实评估，不夸大）

- 全屏卡死 `855aff48d`、盖 macOS 菜单栏 `1d420518a`——两次阻断**修复文件全在 main 进程**（`_fullscreen-state.js` / `_window-ipc.js` / `_app-menu.js` / `_window-create.js`），不是自绘顶栏渲染层。
- 根因（兴奋 CDP 实证已确认）：owner 先用原生键进 native 全屏、再点自绘按钮切 simple 叠加，**native/simple 两状态机互不知晓**故卡住；统一状态机后四态全通，进入一律 native（`_fullscreen-state.js:22-27`）。
- **诚实结论**：owner「回归都发生在自绘路径」——**部分成立**：自绘按钮是 simple 态的入口之一；但 bug 本质是 main 进程双状态机设计，且已统一修复。恢复原生顶栏**会移除自绘按钮这个 simple 入口**，降低再次叠加的概率；但**不能替代**状态机代码本身（其他入口/快捷键仍可能触发），"恢复原生=全屏 bug 根治"是不成立的推论。A 案收益应表述为"减少自定义交互面"，不是"消除状态机"。

## §4 两案对比

### 案 A — 恢复原生（`frame:true` / `titleBarStyle` 标准，移除自绘层）
- **收益**：①窗口控制行为全部交给 OS（全屏/最大化/红绿灯零自定义状态机、零"红绿灯消失"回归面）②删除自绘按钮+轨道+IPC 适配层，维护成本下降 ③开发调试少一层 renderer/main 几何对齐。
- **代价**：①**视觉回退**——推翻 UI-120 裁决，回到 macOS 原生交通灯 + 灰"井"，与当前 Codex/Cursor 风格不一致（owner 需明确接受）②自定义元素需新位置：通知铃铛/更新胶囊→内容区状态栏或右栏；审阅徽章→右栏 tab 内；更多工具菜单→需找新入口（如应用菜单/右栏内）③`frame:true` 下窗口控制与 renderer chrome 两套几何**可能重现 UI-120 当年的问题**（需实机验证）④测试实例 `[TEST]` 标题前缀改走原生 title 即可（低风险）。
- **风险**：回归面大（顶栏相关 11+6 项原验收需重跑）；原生菜单栏/全屏行为改变 owner 肌肉记忆。

### 案 B — 保留自绘、只修状态机（**当前状态**）
- **收益**：①视觉零变化、UI-120 裁决不动 ②今日两次阻断**已修完**（统一状态机+进入 native、四态全通）③自定义入口（通知/更新/工具菜单）位置不变。
- **代价**：①自绘路径仍是 bug 高发区（历史上"红绿灯消失"/"折叠溢出"/今日全屏两阻断的 simple 入口都在此）②维护成本高（三按钮+IPC+几何对齐+状态机持续维护）③owner 明确表示"总觉得不够原生可靠"——信任成本未消除。

## §5 案 A 迁移方案（若 owner 拍 A）

| 步骤 | 内容 | 回归面 |
|---|---|---|
|1|`frame:true` + `titleBarStyle`（mac 可 `hiddenInset` 或默认）替换 `frame:false`（`_window-create.js:124`）|窗口几何、双击缩放、Cmd+M/W|
|2|移除 TitleBarLeftZone 自绘三按钮 + 对应 preload/IPC 适配（保留其他窗口 IPC）|TitleBar 11/11 + IPC 6/6 原验收重跑|
|3|通知铃铛/更新胶囊/审阅徽章迁移到内容区或右栏（位置需 owner 二次裁决）|通知中心/未读徽章功能|
|4|「更多工具」菜单入口迁移（应用菜单或右栏内）|右栏 13 入口可达性、四组分组|
|5|视觉对照稿实机比对 + 亮暗/1050~720px AX 实机复验|UI-120 原实机矩阵|
|6|测试实例 `[TEST]` 标题走原生 document.title（低风险）|测试实例识别|

- **工作量估算**：中-大（多文件 + 实机矩阵重跑 + 2 处 owner 二次裁决：自定义元素落位、视觉接受度）。建议独立工作包，不与 G1 六序并行抢资源。
- **回退**：`frame:false` 与自绘组件可恢复（git 历史完整：c07d9caf3 + 08-09 补全），但自定义元素落位一旦迁移需再迁回——建议迁移前做 visual-comparison.html 存档。

## §6 裁决点

| # | 裁决点 | seat 建议 |
|---|---|---|
|1|A（恢复原生）还是 B（保留自绘）？|**倾向 A**——owner 的可靠性诉求成立、自绘历史 bug 密度高；但须接受视觉回退与自定义元素迁移。若 owner 更看重 UI-120 视觉统一，则 B（今日 bug 已修完）。|
|2|若 A：通知铃铛/更新胶囊/审阅徽章落位？|建议：铃铛+更新→内容区状态栏（右上角），审阅徽章→右栏 tab 内（已有数据源）|
|3|若 A：「更多工具」菜单新入口？|建议：应用原生菜单（macOS 菜单栏）+ 右栏内保留常用入口，避免再造自绘浮层|
|4|是否接受 UI-120 视觉回退（原生交通灯+灰井）？|需 owner 明确过目 `visual-comparison.html` 后拍板|

status: pending_user_ruling · 零代码 · 拍板前不动顶栏。
