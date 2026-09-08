# BLOCK-63 — Windows 电脑控制模块（Computer Use for Windows）技术调研与实施计划

> 状态：`active`（2026-09-08 用户裁决「开搞 完成」P1+ 实施一次做完：P0 调研立项 ✅ → P1 sidecar PoC ✅ `8575a682` → P2 工具面完整化 ✅ → P3 编排注册 / P4 实机验收 / P5 收口进行中。G0 开发期常态 · 不外推 packaged/Provider/GA）
> 立项日期：2026-09-08
> truthDomain: `block-63-windows-computer-use`

## 1. 背景与动机

- BLOCK-48（macOS 电脑控制）已于 2026-09-06 整包收口（`449e5c3d`，P0–P5 completed，acceptance/block-48/ 证据在库），其 plan §5 明确把「Windows / UI Automation 跨平台实现」列为非范围后续评估项。
- 用户 2026-09-08 裁决：为 BLOCK-48 新增 Windows 侧对应能力，新立项调研（本文档）。
- 对标依据同 BLOCK-48：TRAE 插件解剖结论中的**平台模板化注入**——macOS → Accessibility APIs / **Windows → UI Automation**。Windows 是产品当前实际开发机平台（dev Electron 实机链路在位），Windows 侧落地后 agent 跨应用操作能力首次可在本机真实验证。

## 2. 技术调研结论（Windows 侧双层架构，对标 macOS）

### 2.1 双层执行架构对标

| 层 | macOS（BLOCK-48 已落地） | Windows（本包调研结论） | 性能 |
| --- | --- | --- | --- |
| **语义层** | `AXUIElement`（AX 树 + ~30 个 AX 动作） | **UI Automation（UIA3 COM，UIAutomationCore.dll）**：ControlType/Name/Value/BoundingRectangle/AutomationId 树 + 控制模式（InvokePattern≈AXPress、ValuePattern≈SetValue、Toggle/ExpandCollapse/SelectionItem/LegacyIAccessible 兜底） | ~10–100ms/次 |
| **合成层** | `CGEvent` + `CGEventPostToPid`（后台投递） | **`SendInput`**（前台硬件级；**无 per-PID 后台投递等价物**） | 同级 |
| **截图** | ScreenCaptureKit 按窗口（遮挡免疫） | **Windows.Graphics.Capture**（Win10 1803+，按窗口遮挡免疫等价）；GDI `PrintWindow(PW_RENDERFULLCONTENT)` 兜底（Chromium 内容可捕获） | 同级 |

- **关键架构差异（与 macOS 的本质不同）**：Windows 没有 `CGEventPostToPid` 式后台 HID 投递。后台操作必须走 **UIA 控制模式**（Invoke/Value/Toggle 等，不动焦点不抢鼠标）；坐标级 `SendInput` 只能前台。因此 Windows 侧「语义动作优先、坐标兜底必须激活前台」的路由纪律比 macOS 更严格，`activate:true` 前台兜底语义保留。
- 性能结论与 macOS 同构：UIA 语义路线 ~10–100ms 级 vs 截图+vision 路线 ~2500ms 级，语义优先纪律保持。

### 2.2 sidecar 技术选型比选（P0 核心裁决点）

| 方案 | 说明 | 判定 |
| --- | --- | --- |
| **A. C#/.NET 8 + FlaUI 5.0（UIA3）**（建议主选） | UIA3 成熟封装（v5.0.0，2025-02 发布，活跃维护，支持 .NET 8）；`dotnet publish -r win-x64` 自包含单文件产物；stdio JSON 协议与 macOS sidecar 同构 | ✅ 对标 macOS Swift sidecar 决策：单编译产物、0 npm 依赖、进程故障隔离、绕开 Electron ABI 纠缠；Win10+ 全覆盖 |
| B. Python + pywinauto / uiautomation | 复用应用既有 provisioned Python runtime（0 新工具链）；两库均活跃维护 | ⚠️ 备选：省编译工具链，但依赖 runtime site-packages 安装步骤与 Python 版本耦合；pywinauto 双 backend（Win32+UIA）对 legacy Win32 app 兜底更厚 |
| C. Rust（windows-rs）/ C++ | 性能与产物体积最优 | ❌ 工具链与开发成本最高，P1 收益不匹配 |
| D. WinAppDriver | 微软官方但已停滞 | ❌ 排除 |

> 2025 现状核实：FlaUI v5.0.0（2025-02）活跃（NuGet `FlaUI.Core`/`FlaUI.UIA3`）；pywinauto 与 yinkaisheng/Python-UIAutomation-for-Windows 均活跃；WinAppDriver 停滞。来源见 §9。

### 2.3 已知坑（Windows 特有，P1 实机复核清单）

| 坑 | 现象 | 对策 |
| --- | --- | --- |
| **UAC 完整性级别边界** | 非提权进程无法读/自动化提权（管理员）窗口；UAC secure desktop 完全不可达 | probe 诚实探测（宿主/目标提权态）+ 中文引导；提权自动化（UIAccess 签名链）列非范围 |
| **Chromium/Electron UIA 懒启用** | Chromium 系 app 的 UIA 树按需启用（AT 客户端探测），宿主外的 Electron app 可能树稀疏 | 宿主自身 `app.setAccessibilitySupportEnabled(true)`；外部 app 走 UIA 客户端连接探测 + `--force-renderer-accessibility` 提示；P1 实机复现与规避（对标 macOS AXManualAccessibility 记录） |
| **legacy Win32 树稀疏** | 部分 Win32/MFC app UIA 属性不全 | LegacyIAccessible（MSAA）兜底 + 坐标 SendInput 兜底 |
| **DPI per-monitor v2** | 多屏/缩放下坐标错位 | sidecar 清单声明 PerMonitorV2；坐标统一物理像素 |
| **锁屏 / secure desktop** | 锁屏、UAC 确认界面不可自动化 | 诚实报错（desktop_secure） |
| **EDR/杀软启发式** | SendInput 高频合成可能被启发式拦截 | 低概率，登记观察；无对策（不白名单自身） |

### 2.4 复用面（macOS 包已建好的平台无关层）

- `core/biof3-server/helpers/computer-use-host.js`：stdio 行式 JSON 协议（`{id, verb, params}` → `{id, ok, data|error}`）、spawn/健康/死亡恢复/一次重启恢复——**协议平台无关**，仅需把 macOS-only 平台门改为按 OS 选二进制。
- `agent-tools/computer-use-tools.js` 八工具 + registry/schema + 授权门（两段式 ackToken）+ policy 矩阵（read/planMode/workspace-write 自动拒绝）+ screenshot 路径白名单——**全部零改动复用**。
- Windows 侧只新增：sidecar 二进制产物（`sidecars/computer-use-windows/` 或同级命名）+ host 平台门 + 工具注册的平台条件化（非 Windows 诚实报错保持现状）。

## 3. 目标架构（初步设计）

```
biof3-server (Node)                     Windows sidecar（C#/.NET 8 + FlaUI，新增）
  agent 工具注册（同 8 工具）              UIA 感知 + SendInput/模式执行
  computer_snapshot ──── stdio JSON ───►  snapshot（UIA 树→refs）
  computer_click      ───────────────►  click（InvokePattern 优先，SendInput 坐标兜底前台）
  computer_type/press ───────────────►  type（ValuePattern 后台优先/SendInput 前台）/press（键码表）
  computer_scroll/drag ──────────────►  scroll/drag（SendInput 前台）
  computer_screenshot ───────────────►  Windows.Graphics.Capture 按窗口（PNG 落盘）
  computer_wait       ───────────────►  waitForElement（自适应轮询，同 macOS 参数）
  computer_authorize ───────────────►  提权态/桌面态诚实探测 + 引导信息
```

## 4. 阶段划分（P1+ 启动需用户裁决）

- **P0 立项（本文档，已完成 2026-09-08）**：调研 + 本计划落盘 + DOC-REGISTRY 注册 + roadmap/README 入口；BLOCK-48 治理漂移校正（roadmap 排队行/registry planned → completed）。
- **P1 sidecar PoC**：最小二进制（probe + snapshot + click）跑通；**记事本/计算器真实闭环**；Chromium UIA 懒启用坑在 dev Electron 本机复现与规避；技术选型 A/B 最终确认回写本 plan。
- **P2 工具面完整化**：八动词 + ValuePattern 后台 type + 元素等待 + 按窗口截图；隔离 fixture 靶 app（最小 WinForms/记事本，绝不指向用户真实应用）+ 真行为单测。
- **P3 进程编排与注册**：host 平台门（win32 分支 + 二进制定位）+ 工具注册平台条件化 + 授权门/黑名单同构接线；0 新增前端 IPC。
- **P4 dev Electron 实机验收**：真实跨 app 任务（记事本/计算器/第三方 app「读状态→点击→输入→验证」闭环，安全纪律对齐 BLOCK-48 P4：新窗口未建即硬中止、不污染用户文档）；证据 `acceptance/block-63/`。
- **P5 收口**：台账/roadmap/registry 回写。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 5. 非范围（G0 边界）

- macOS 侧任何改动（BLOCK-48 冻结在已收口状态）。
- 提权（admin）窗口自动化与 UIAccess 签名链；UAC secure desktop 自动化。
- vision 模型视觉兜底链路（与 macOS 侧同候选）。
- packaged 内置 sidecar 分发（随打包流水线另议，G1+）。
- 0 新 npm 顶层依赖（sidecar 走 dotnet publish，不入 dependency 树）。

## 6. 验收门（启动时细化）

- P1：PoC 在本机真实完成一次 snapshot→click 闭环（记事本或计算器）+ Electron UIA 坑复现/规避记录 + 选型终判回写。
- P2：sidecar 定向单测全绿（node --test 驱动 stdio 契约 + fixture 真行为）。
- P3：tsc 0 / 后端定向测试 / docs:check / ui:audit:check（涉及 UI 时）。
- P4：dev Electron 实机跨 app 任务证据 `acceptance/block-63/`。
- 治理门禁 `docs:check` + `docs:reconcile` 收口必跑。

## 7. 进度记录

- 2026-09-08 P3 收口（completed，**编排注册**）：① **host 平台门双平台化**（core/biof3-server/helpers/computer-use-host.js）：defaultSidecarPath 按平台选路（win32 → sidecars/computer-use-windows/bin/publish/gewu-computer-use-windows.exe，env BIOF3_COMPUTER_USE_SIDECAR 覆盖优先不变）；ensureRunning 平台门 darwin|win32 双支持（其余平台 unsupported_platform 诚实报错，文案双平台）；sidecar_not_built 构建指引按平台分叉（Windows → build.ps1）。② **tool-defs 八工具描述双平台化**：【macOS/Windows】统一标注 + 平台差异如实（snapshot 的 bundleId→进程名映射与 axManual macOS-only 边界、type 的 Windows 被拦宿主诚实上报、press 修饰键 win + 被拦 fail-closed、screenshot 权限差异、authorize 平台语义）。computer-use-tools.js 协议层零改动（target{frontmost|pid|bundleId}/ref/text/key+modifiers/direction+amount/out/role+textContains+timeoutMs 双平台同形，Windows sidecar 语义映射 bundleId→进程名）。③ **新测试 test/block63-computer-host.test.mjs 12/12**（对标 block48 模式 + 3min watchdog）：平台门与定位（win32 路径/env 覆盖/linux 模拟 unsupported_platform/缺二进制 build.ps1 指引/probe 形状 platform=windows+trusted+hostElevated/死亡恢复）+ 注册表 8 工具契约（含描述双平台断言）+ 政策矩阵 + **handler 确认门两段式真链**（needApproval→伪造拒→db.ackToolJob 批准→type 经 ValuePattern 回写→复照语义树实证，axfixture 靶全程不碰用户应用）。④ **连带修**：block48-computer-tools.test.mjs 两个 macOS 专属 describe 加诚实 skip 门（Windows 上因平台门改道后原断言失效；平台无关的注册表/政策矩阵继续跑）—— AUDIT-LOG 09-06 所记 block48 沙箱挂起问题的 Windows 侧行为随之澄清。⑤ 工程教训（本会话工程纪律升级）：**同一文件多个并行 Edit 会相互覆写**（tool-defs/Native 两度丢写入），同一文件编辑必须串行。⑥ 回归：契约 8/8 + tools 9/9 + host 12/12 + block48 4/4（Windows 平台无关面）。P4（实机验收）待启动。

- 2026-09-08 P2 收口（completed，**工具面完整化**）：① **八动词 + close 落地**：probe/snapshot/click/type/press/scroll/screenshot/wait + close（WM_CLOSE hwnd 粒度——P1 记事本单进程多窗口连带关闭事件的纪律升级）；axfixture 隔离靶 app（WinForms 窗口 + TextBox + 计数按钮）由测试 spawn/kill，绝不指向用户应用。② **激活/焦点纪律**（P2 实机教训）：UIA SetFocus 只设元素焦点，窗口不激活时 SendInput 打到别的活动窗口——ActivateWindow（AttachThreadInput 舞步 + 5 次重试至 GetForegroundWindow==hwnd）→ FocusInto（GetFocusedElement 反查 RuntimeId 校验）→ 注入；失败 fail-closed（not_focused / focus_refused）。③ **实机抓真 bug 与环境发现（本条为本包最重要实证）**：**本机宿主安全层静默拦截合成键盘输入**——SendInput 键盘事件（VK 路径 / scancode 路径 / Python ctypes 独立进程三路径交叉验证）全被吞：事件未进 GetAsyncKeyState 异步键态（探测器实证 asyncKeyStateReached=false），SendInput 表面返回 1、UIA 焦点校验通过、前台归属正确，但控件零反应；同一进程鼠标注入正常可达、PostMessage WM_CHAR 正常可达（本机安全策略风格与既有 Add-Type/COM 拦截一致）。④ **press 设计升级（诚实降级）**：SendInput 主路径 + KeydownReachedAsyncState 探测（KEYDOWN 后 50ms 轮询异步键态高位）→ 被拦即消息级注入回退（WM_CHAR 文本/编辑字符键、WM_KEYDOWN+WM_KEYUP 导航键，直投 UIA 焦点控件 hwnd），响应 mode="message_post" + sendinputFiltered=true 如实上报；**修饰键组合被拦 fail-closed**（keyboard_inject_blocked——消息级无法等价修饰键态，宁报不做）。⑤ **次生坑修复**：scan=0 时 TranslateMessage 无法为 Edit 类控件生成 WM_CHAR → KeyByVk 统一 MapVirtualKey 补硬件扫描码；FlaUI 5.0 API 适配再登记——NativeWindowHandle 为 AutomationProperty<nint> 包装（隐式转 nint，不可直接调 ToInt64）。⑥ **WinForms 靶行为坑（测试语义修正，非 sidecar bug）**：TextBox OnGotFocus 会 SelectAll——程序化改文本（ValuePattern.SetValue）后控件首次被点击聚焦时全选（实机实证：click 后按 z 整段被替换为 z）；测试改为 click → end（收拢选区）→ backspace，「删除末字符」语义不变。⑦ **type 边界如实登记**：含换行的 type（SendInput 逐字路径）在此类被拦宿主上静默无效——代码注释已标注，此类宿主优先无换行 type（走 ValuePattern）；P4 实机注意。⑧ 门禁：契约 8/8 + tools 真行为 9/9（fixture 驱动真实键鼠/截图/close 全链）+ docs:check/reconcile + ui:audit:check。P3（编排注册）待启动。
- 2026-09-08 P1 收口（completed，**选型终判：方案 A（C#/.NET 8 + FlaUI 5.0 UIA3）确认**）：① **工具链**：本机无 .NET SDK → dotnet-install 用户级安装 8.0.424（免管理员、不污染系统；SDK 仅构建用，产物自包含）。② **sidecar 骨架**（`sidecars/computer-use-windows/`：Program.cs 协议循环 / AutomationService.cs UIA 感知动作 / Native.cs user32 互操作 / build.ps1）：stdio 行式 JSON 与 macOS 逐字同构；FlaUI 5.0 API 适配三条如实登记——`Patterns.Value` 为 `IAutomationPattern<IValuePattern>` 包装需 `.Pattern.Value` 双跳取值、`FocusedElement()` 为方法、RuntimeId 经 `FrameworkAutomationElement.RuntimeId`（AutomationProperty 包装）隐式取值。③ **发布**：单文件自包含 162MB（trim 候选留 P3）。④ **契约测试**（test/block63-sidecar-contract.test.mjs）8/8：probe 形状 / bad_request 后协议存活 / unknown_verb / click 无 ref=target_required / 未知 ref=unknown_ref / snapshot 形状（refs/role/name/rect/truncated）/ snapshot→click 双路（invoke|coordinate）/ stale ref。**实机抓真 bug 一条**：JsonElement 为已释放 JsonDocument 的视图——using 作用域外访问即 internal_error，已改为作用域内物化纯 CLR 值；连带契约对齐（载荷键小驼峰 JsonSerializerOptions，对齐 macOS 裸小写键）。⑤ **实机闭环 6/6**（scripts/block63-p1-live.mjs，证据 `acceptance/block-63/p1-live.json`）：probe trusted / 记事本 snapshot 69 元素（roles 含 Document/Tab/Button）/ 编辑区 click=coordinate（Invoke 不支持自动兜底）/ 复照 focusedRole=Document（焦点证据）/ dev Electron UIA 观测 69 元素（Chromium UIA 客户端连接即暴露，深度优化留 P4）/ 零 internal_error。**纪律事件（如实登记）**：Windows 11 记事本单进程多窗口——清理按 pid kill 连带关闭了用户已打开的 total_proteome [2].tsv 窗口（该文档无未保存修改、零数据丢失；文件路径不在 shell Recent，无法自动重开，用户可从记事本自带最近列表恢复）；**纪律升级：P2 起 sidecar 增加 hwnd 粒度 close 动词，脚本清理禁止进程级 kill**（live 脚本已改为不自动清理目标 app，对齐 BLOCK-48 P1 先例）。⑥ 附带：test:changed:list 存量 3 脚本未分类 fail-closed 已修（ui310/block63/dev-toolchain 归类）。P2（工具面完整化）待启动。
- 2026-09-08 P0（planned 登记，**调研立项完成**）：① 现状核实——BLOCK-48 已整包收口（`449e5c3d`，acceptance 在库），其 §5 非范围「Windows / UI Automation」即本包范围；② Windows 双层架构调研（UIA3 语义层对标 AX、SendInput 无后台投递的架构差异、Windows.Graphics.Capture 遮挡免疫等价、UAC 边界/Chromium UIA 懒启用/DPI 等坑清单）；③ sidecar 选型比选（FlaUI 5.0 主选建议，2025-02 v5.0 活跃维护核实；Python 方案备选；WinAppDriver 停滞排除）；④ 复用面确认（host 协议/8 工具/授权门/policy 矩阵平台无关零改动复用）；⑤ 连带治理校正：BLOCK-48 的 roadmap 排队行与 DOC-REGISTRY planned 状态为存量漂移，已按 git/acceptance 证据校正为 completed。实施启动（P1+）待用户裁决。
