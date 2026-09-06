# BLOCK-48 — macOS 电脑控制模块（Computer Use）技术调研与实施计划

> 状态：`active`（2026-09-06 **恢复 active**：BLOCK-61 品牌改名已整包收口 `526dd72b`，改名后回归全绿（brand/sidecar/window-manager 51/51 + main.js 回归 11/11 + sidecar 重建 probe trusted）。**P1 已于让位期间完成收口**（`f0aba445`：snapshot→click 闭环 + 权限链路 + Electron AX 坑规避，实机 10 断言 allPass——比暂停登记的检查点 `c29d9f04` 骨架更完整的边界），下一步 P2 七工具完整化。首启记录：2026-09-06 用户裁决「BLOCK-48 开干」；同日曾让位 BLOCK-61 改名先行，改名收口后恢复）
> 立项日期：2026-09-03；启动日期：2026-09-06
> truthDomain: `block-48-computer-use`
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

- 2026-09-06 P3 收口（completed）：**进程编排与 agent 工具注册**。① **托管模块**（helpers/computer-use-host.js）：单例 SidecarHost——spawn + stdio 行式 JSON 协议（id 复用）+ 死亡即弃/超时杀进程 + **一次重启恢复**（requestWithRecovery 仅对 sidecar_died/timeout 重试；结构性错误不重试）+ 二进制定位（env BIOF3_COMPUTER_USE_SIDECAR > 仓库 sidecars 路径，注意 helpers 三级向上）+ 仅 macOS/未构建诚实报错。② **八工具注册**（agent-tools/computer-use-tools.js + registry + tool-defs schema，对标 ide_*/既有模式）：computer_snapshot/authorize/wait 为只读面（verification/none），click/type/press/scroll 为控制面（action/execution/R2 → **policy 矩阵自动拒绝 read/planMode/workspace-write，仅完全访问档**——授权门第一件零新代码），screenshot = vision/workspace-write/R1（产物落项目工作区，项目写档即可用）。③ **独立确认授权步骤**：控制类两段式 ackToken 协议（对标 run_tool 重操作，复用既有前端确认卡 + ai-legacy approve REST + tool_jobs 审计，零新前端）——首调建 pending tool_job + ackToken 返回 needApproval；用户批准后 confirm+ackToken 重调，核验通过才执行，job 终态回写。④ **路径白名单**：screenshot 产物仅落 <workspace>/computer-use/<basename>.png（project_required / project_not_found / basename 消毒）。⑤ **单测 15/15**：托管协议（probe/死亡恢复/unknown_verb）+ 契约 8 工具 + 政策矩阵（3 工具 × 档位）+ handler 真实链（确认门两段式全链：needApproval → 伪造 token 拒 → ackToolJob 批准 → 执行落 sidecar no_target_snapshot 证明过门；screenshot 路径门两路；wait 双态）。⑤ 总回归 77/77（契约 9 + 工具面 11 + P3 15 + 窗口管理器 38 + brand 4）。**实现教训**：sidecar 载荷无 ok 字段需 okWrap（契约测试抓到）；node:test 静态 skip 求值坑；registry 为冻结数组非 Map。0 新 npm 依赖。P4（dev Electron 实机跨 app 任务验收）待启动。
- 2026-09-06 P2 收口（completed）：**工具面完整化——五动词 + 隔离 fixture + 真行为单测**。① **五动词落地**（InputController.swift，AXController 扩展）：`type`（逐字符 unicode 键盘注入 postToPid，\n 映射回车键，ref 定位聚焦，activate:true 前台兜底）；`press`（16 键虚拟键码表 + cmd/shift/alt/ctrl 修饰位）；`scroll`（scrollWheelEvent2 专用初始化器——**本 SDK `.scrollWheel` 构造器废弃且恒返回 nil**，4 参 CopyAttributeValue 同批审计；axis1 垂直/axis2 水平，行单位）；`screenshot`（CGWindowListCreateImage `.optionIncludingWindow` **遮挡免疫**按窗口取像 → PNG 落盘绝对路径，需屏幕录制权限，probe 增 `screenTrusted` 诚实探测——本机已授权直接通过）；`wait`（自适应轮询 150ms×1.3→1s，role/textContains/ref 三种匹配，目标消失诚实等到超时）。② **axfixture 隔离靶 app**（SPM 第二 target）：最小 AppKit 窗口 + 文本框 + 按钮（点击回写计数），由测试 spawn/kill，绝不指向用户真实应用。③ **单测 11/11 全真行为**：type 注入「hello 格物 123」后语义树 value 实证（CJK 通过）；press delete 精确删除末字符（值 …123→…12）；按钮 AXPress 动作回写 clicked 计数 + wait textContains 命中；screenshot PNG 魔数 + 尺寸；wait 正/负超时两路；非法键/空文本 fail-closed。④ **macOS 26 SDK 坑新增两条登记**：AXActions 属性查询返回 attributeUnsupported（-25205，属性已移除）→ AXPress 改直接执行以结果为准；`.scrollWheel` CGEvent 构造器恒返回 nil → 必须用 scrollWheelEvent2 初始化器。⑤ 契约测试抓到 snapshot 重构回归（目标解析失败被包成 ok:true）——已修，契约+工具面 20/20。0 新 npm 依赖。P3（backend-proc-manager 托管 + agent 工具注册 + 授权门）待启动。
- 2026-09-06 P1 收口（completed）：**用户手动授权 ZCode 辅助功能后全链打通**。① **权限引导路径记录（P1 验收门之一）**：probe 未授权 → 引导文案 → 用户系统设置手动加 ZCode → probe `trusted:true`——TCC 不可编程授予实锤，引导→授权→生效链路全程可观测。② **snapshot→click 闭环（P1 验收门之二，真实完成）**：TextEdit 运行中模式——语义树读取（300 元素）→ 语义定位 AXTextArea → CGEvent postToPid 坐标点击（后台投递，point [543,393]）→ 快照复核 **focusedRole=AXTextArea**（焦点证据）。安全纪律：TextEdit 可能含用户未保存内容（实机出现用户文档「未命名2」），脚本**不自动退出**目标 app，清理决策归用户。③ **Electron AX 懒初始化坑（复现 + 规避）**：首轮观测 before=131 → axmanual 后 203（verdict=mitigated，规避生效）；后续轮次 175/175（verdict=already_initialized）——**AXManualAccessibility 状态按 app 元素持久**，一次设置持续有效（运维含义：宿主只需设置一次）。④ 契约测试 9/9（已授权态全跑：frontmost snapshot 元素形状/注册表点击/axmanual applied+hint；未授权态 fail-closed 路径同测——trust-aware 双态设计）；**测试框架坑**：node:test 的 describe 级 `skip` 选项在收集期静态求值，before 钩子结果影响不到 → 改测试内动态 `t.skip`。门禁：契约 9/9 + 实机 p1-live.json 10 断言 allPass（`acceptance/block-48/p1-live.json` + p48-01-electron-ax.json）。**P1 遗留观察**：dev Electron 开 CDP 调试端口时 Chromium AX 树部分预初始化（B 场景 before 已 131+），纯生产环境（无 CDP）复现留 P4 实机取证。P2（七工具完整化）待启动。
- 2026-09-06 P1 实施过程（前段记录）：① **Swift sidecar 骨架落地并编译通过**（`sidecars/computer-use/`，SPM swift-tools 5.9，0 第三方依赖；stdio 行式 JSON 协议：`{id, verb, params}` → `{id, ok, data|error}`；四动词 probe/snapshot/click/axmanual）。**本机工具链坑三条（如实登记）**：本机 CLT SDK（MacOSX 26, Swift 6.3.3）下 ① AX C 常量（kAXValueAttribute 等）经 `as CFString` 传入触发重载解析歧义 → AX 属性名/动作名全部改字符串字面量；② `AXUIElementCopyAttributeValue` 已被审计为 **3 参**（error 出参移除，CF_RETURNS_RETAINED value），4 参调用报 "extra argument"；③ 出参指针须 `AnyObject?`（CFTypeRef 已 = Any，`CFTypeRef?` 即 `Any?` 反而不匹配）。② **权限链路实机验证（诚实路径）**：probe 在宿主未授权时如实返回 `trusted:false` + 中文引导文案（系统设置 → 隐私与安全性 → 辅助功能）；snapshot/click 在未授权时 fail-closed（`not_trusted`）——plan §2.3「TCC 不可编程授予」坑实锤复现。**实机环境事实**：本会话责任进程 = ZCode.app（进程树 zsh ← zcode-cli ← zcode-host-local ← ZCode），System Events 深度 AX 读取被拒（-1719「不允许辅助访问」）→ 待用户手动授权 ZCode 后跑 snapshot→click 闭环。③ **契约测试**（test/block48-sidecar-contract.test.mjs）trust-aware 双态设计：未授权态 7 断言全过（probe 形状/bad_request/unknown_verb/target_required/僵尸 pid/unknown_ref/not_trusted fail-closed）+ 已授权态 2 用例诚实跳过（frontmost snapshot + axmanual）。impact-map 补 sidecar 规则与 live 脚本分类；二进制不入 git（bin/.build gitignore）。

- 2026-09-03 P0（planned 登记）：完成 TRAE 插件本体解剖 + 业界范式调研（AX/CGEvent 双层、CGEventPostToPid 后台投递、Electron AX 懒初始化坑、三方案比选）；本计划落盘并注册 DOC-REGISTRY；待 BLOCK-47 收口后由用户裁决启动。

