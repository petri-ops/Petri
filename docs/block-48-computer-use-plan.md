# BLOCK-48 — macOS 电脑控制模块（Computer Use）技术调研与实施计划

> 状态：`active`（2026-09-06 用户裁决「BLOCK-48 开干」启动，当前唯一 active 工作包；P1 Swift sidecar PoC 开工。前期候选序裁决 2026-09-05：排 BLOCK-59 之后，BLOCK-59 已于 2026-09-05 整包收口）
> 立项日期：2026-09-03；启动日期：2026-09-06
> truthDomain: `block-48-computer-use`

## 1. 背景与动机

用户考察 TRAE 宿主的 `trae-remote-official:computer-use` 插件后裁决：深入调研其实现原理，归入独立工作计划，后续为 BioF3 Desktop 增加同型「电脑控制」模块——让 Agent 能跨应用读写 UI、点击、输入，替用户完成跨 app 任务。

### 1.1 TRAE 插件架构解剖（本体研究结论）

- 插件包本体 = **纯注册壳**：`plugin.json`（清单/i18n/图标）+ `.success`（marketplace 安装凭证，25KB 中大头是图标），**零可执行代码**。

- 真实能力内置在宿主：安装效果 = 宿主向主 Agent 注册 `computer_use` subagent 类型（Agent tool 的一种 subagent\_type）。

- subagent 运行时特征：平台模板化注入（macOS → Accessibility APIs / Windows → UI Automation）；感知 = 语义 AX 树 + 多模态 vision（截图）双通道；操作原语 = click / type / scroll / drag / press\_key / select\_option / fill form；**授权门独立成工具**（RequestAuthorization，控电脑前必须用户显式授权）；连续 3 次失败叫停纪律。

## 2. 技术调研结论（业界成熟范式）

### 2.1 双层执行架构（业界共识）

| 层               | API                                    | 职责                                                                                       | 性能       |
| --------------- | -------------------------------------- | ---------------------------------------------------------------------------------------- | -------- |
| **AX 语义层**      | `AXUIElement`（ApplicationServices）     | 读 UI 语义树（role/title/value/position/actions）+ 标准动作（AXPress/AXConfirm/AXActivate 等 \~30 个） | 5–50ms/次 |
| **CGEvent 合成层** | `CGEvent` / `CGEventPostToPid`（Quartz） | HID 层合成鼠标/键盘/滚轮事件，硬件级信任（OS 与物理输入不可区分）                                                    | 同级       |

- 截图+vision 方案（Anthropic Computer Use / OpenAI Operator 路线）单轮 \~2500ms；AX 语义路线 \~50ms——**\~50x 差距**，且无 token 成本、无坐标漂移。

- `CGEventPostToPid` 支持**后台投递**：不抢焦点、不动光标即可驱动目标 app（axcli 已验证对 AppKit 与 Chromium/Electron app 双有效）。

- 智能路由参照（desktop-pilot-mcp 的 Smart Router）：Scriptable app 走 AppleScript / Electron+Native 走 Accessibility / 输入合成统一 CGEvent。

### 2.2 核心工作流（Playwright 式）

```
snapshot（AX 树 → typed refs，如 [e18] TextField "Write a message..."）
  → click @ref（AXPress 优先，坐标 CGEvent 兜底）
  → type @ref "text"（CGEventPostToPid）
  → snapshot / screenshot（断言验证）
```

配套能力：元素等待（自适应轮询 waitForElementAdaptive）、窗口管理（list/resize/frame）、菜单路径点击（File → New Window）、遮挡免疫截图（ScreenCaptureKit 捕获被覆盖窗口）。

### 2.3 已知坑（必须规避）

| 坑                 | 现象                                                                | 对策                                                            |
| ----------------- | ----------------------------------------------------------------- | ------------------------------------------------------------- |
| Electron AX 树懒初始化 | `kAXErrorCannotComplete (-25212)`，自动化间歇性失败                        | 初始化序列 / 外部设置 `AXManualAccessibility`（业界修复后成功率 20–40% → \~99%） |
| Chromium 系 AX 树受限 | Electron app 语义树可能稀疏                                              | 检测到 Chromium app 时回退坐标点击 + 键盘快捷键组合                            |
| TCC 权限不可编程授予      | Accessibility/ScreenRecording 只能用户手动开                             | 权限检查工具 + 引导文案（`System Settings → Privacy & Security`）         |
| 权限三件套             | Accessibility（必须）/ Screen Recording（截图）/ Input Monitoring（部分键盘场景） | 启动时检查并在 UI 诚实呈现缺口                                             |

### 2.4 BioF3 集成路径比选

| 方案                          | 说明                                              | 判定                                                                                                                  |
| --------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **A. Swift sidecar 进程**（推荐） | `swift build` 产物，stdio JSON-RPC；主进程/后端 spawn 编排 | ✅ 原生访问 AXUIElement/CGEvent 最顺；独立进程故障隔离；**绕开 Electron ABI 问题**（BLOCK-32 教训：主进程直连 better-sqlite3 即 ABI 123 vs 137 崩溃） |
| B. C++ node-gyp addon       | 嵌入主进程的 native 模块                                | ❌ 编译链复杂，Electron ABI 对齐是长期维护债                                                                                       |
| C. AppleScript osascript 桥  | 零编译，走 System Events                             | ❌ 能力弱、性能差、错误面粗糙，仅适合兜底                                                                                               |

## 3. 目标架构（初步设计）

```
biof3-server (Node)                    Swift sidecar（新增，backend-proc-manager 托管）
  agent 工具注册                          AX 感知 + CGEvent 执行
  computer_snapshot ──── stdio JSON ───►  snapshot（AX 树→refs）
  computer_click      ───────────────►  click（AXPress/CGEvent 自适应路由）
  computer_type/press ───────────────►  type/press（CGEventPostToPid 后台投递）
  computer_scroll/drag ──────────────►  scroll/drag
  computer_screenshot ───────────────►  ScreenCaptureKit（验证通道）
  computer_wait       ───────────────►  waitForElement（自适应轮询）
  computer_authorize ───────────────►  TCC 权限检查 + 引导信息
```

- **工具注册对标** **`G0-IDE-MCP-TOOLS`** **既有 18 个** **`ide_*`** **工具模式**（注册表/路径白名单/审计三件安全约束保持同构）。

- **授权门**：电脑控制类工具要求 `accessMode: full` 且经独立授权步骤；高危动作过 `commandVerdict` 黑名单体系（与 workspace\_exec 同门）。

- **Agent 循环**：agent-runner 工具 schema 注册后模型可见；G0 不做 vision 视觉兜底（AX 优先，视觉链路留候选）。

## 4. 阶段划分（待启动后执行）

- **P0 立项**：本文档 + DOC-REGISTRY 注册 + roadmap/README 入口 + AUDIT-LOG 登记。

- **P1 Swift sidecar PoC**：最小二进制（snapshot + click）跑通；权限链路实机验证；**Electron AX 懒初始化坑在本机复现与规避**；评估结论回写本 plan。

- **P2 工具面完整化**：七工具 + 后台投递 + 元素等待 + 遮挡免疫截图；sidecar 单测（隔离临时 app fixture）。

- **P3 进程编排与注册**：backend-proc-manager 模式托管（spawn/health/回收）；agent 工具注册表 + schema；授权门与黑名单接线；0 新增前端 IPC（MCP 暴露另议）。

- **P4 dev Electron 实机验收**：真实跨 app 任务（如驱动 TextEdit/ Finder/第三方 app 完成「读状态→点击→输入→验证」闭环）；证据 `acceptance/block-48/`。

- **P5 收口**：台账/roadmap/registry 回写，G0 开发期常态 · 不外推 packaged/Provider/GA。

## 5. 非范围（G0 边界）

- Windows / UI Automation 跨平台实现（后续按 TRAE 模板化路线评估）。

- vision 模型视觉兜底链路（截图→多模态理解）。

- packaged Electron 内置 sidecar 分发（随打包流水线另议）。

- 任意文件系统/提权操作（沙箱与黑名单边界不动）。

- 0 新 npm 顶层依赖（sidecar 由 Swift Package Manager 构建，不入 dependency 树）。

## 6. 验收门（启动时细化）

- P1：PoC 在本机真实完成一次 snapshot→click 闭环 + 权限引导路径记录。

- P2：sidecar 定向单测全绿（node --test 驱动 stdio 契约）。

- P3：tsc 0 / 后端定向测试 / docs:check / ui:audit:check（涉及 UI 时）。

- P4：dev Electron 实机跨 app 任务证据 + 新 UI 编号台账（如有 UI 面）。

- 治理门禁 `docs:check` + `docs:reconcile` 收口必跑。

## 7. 进度记录

- 2026-09-03 P0（planned 登记）：完成 TRAE 插件本体解剖 + 业界范式调研（AX/CGEvent 双层、CGEventPostToPid 后台投递、Electron AX 懒初始化坑、三方案比选）；本计划落盘并注册 DOC-REGISTRY；待 BLOCK-47 收口后由用户裁决启动。

