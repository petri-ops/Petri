---
capability: block-345-computer-use-closure
status: planned
goal: 把 computer-use（电脑使用）从「底座齐全但用户可见闭环断开」修到「控制类真能被用户批准、画中画真能出画面、工具面契约自洽」：补上前端 ackToken 确认卡渲染路径、修通 PiP 截帧链（out 参数 + 帧回传形状）、暴露 computer_close 并清理元数据/schema/超时漂移，最后把三处断链变成机械门禁（第三条同类缺陷不再可能静默复发）。
acceptance:
  - P1 控制类确认卡接入：computer_* 的 needApproval/ackToken 在桌面端有可见入口（卡片渲染 + 批准/拒绝走既有 run-tool-ack），且渲染条件不被 accessMode 与 run_tool 硬编码互斥锁死；契约=前端组件测试 + 后端事件上抬测试。
  - P2 PiP 截帧链修复：/api/computer-use/pip-frame 真实取到画面（补 out 绝对路径 + 帧以文件路径或 base64 回传，两侧 sidecar 契约一致），macOS 无 snapshot 时诚实引导而非空帧；契约=Node 测试覆盖「帧形状可用」+ 实机 PiP 窗口截图非空。
  - P3 工具面与契约自洽：暴露 computer_close（Windows verb 已存在，macOS 缺失须诚实 unsupported）、computer_authorize 元数据与 R0 契约对齐、hwnd/summary 进 schema、computer_wait 三处超时数字统一为单源。
  - P4 门禁化与收口：三条断链各留一条机械断言（PiP 必须真出帧 / 控制类必须有 UI 批准入口 / close 必须在工具面），定向测试 + types + lint + docs/ui 门禁 + 实机腿 + closeout 十三门全绿。
reopen: 应用/窗口白名单（default_app_access + macOS bundle_ids / Windows aumid 逐应用授权）；computer-use 总开关与 composer 入口；drag/双击/右键/hover/移光标/剪贴板/多显示器；Linux 平台实现；Windows sidecar 二进制入库与签名分发（G1+ 不外推）。
---

# BLOCK-345-COMPUTER-USE-CLOSURE — 电脑使用闭环修补计划

- 登记状态：**planned（2026-11-04 立项；排队 BLOCK-344 之后，不并行开工）**
- 用户裁决原话：「可以的 开整」（承接 2026-11-04 电脑使用能力核对报告的单一建议「computer-use 闭环修补（拟立 BLOCK-345，planned 排队于 344 之后）」）
- 与 BLOCK-344 关系：**串行排队**（单工作包纪律），文件面不相交（344=3D/SceneSpec 面；本包=computer-use 链），`touchSurface` 已登记供并行契约判据使用，但当前不并行

---

## §1 立项依据（2026-11-04 只读核对实证）

底座是完整的：双平台 sidecar（macOS Swift 10 verb / Windows C# 9 verb，行式 JSON 同构）、`helpers/computer-use-host.js` 托管（spawn/30s 超时/一次重启恢复/平台门）、8 个 `computer_*` 工具注册 + 契约 + 政策矩阵（控制类仅完全访问档）、两段式 ackToken + `tool_jobs` 审计、screenshot 项目内路径白名单、设置面板状态面（UI-542 verified）。

实测（本机 macOS，权限已授）：`probe` → `{"screenTrusted":true,"trusted":true}`；`snapshot` 真实读到前台应用语义树（AXApplication/AXWindow + ref 集）；`test/block48-computer-tools.test.mjs` 加 `--test-force-exit` 后 **15/15**。

但存在三处结构性断链（"宣称闭环、实际断开"）：

| # | 断链 | 证据 |
| --- | --- | --- |
| 1 | **控制类无用户批准入口** | 服务端只在 `envelope.tool === 'run_tool'` 上抬 `needApproval/ackToken`（`core/petri-server/agent-tools/tool-events.js:207`）；前端 `pendingApproval` 生成条件硬编码 `event.name === 'run_tool'`（`frontend/src/components/copilot/conversationRunStore.ts:513`）；唯一确认卡渲染条件还带 `accessMode !== 'full'`（`frontend/src/components/copilot/SimpleChat.tsx:1566`），而控制类**只在 full 档放行**——两条件互斥。`GuardAckCard` 数据源是 guard 信封，不覆盖 tool_jobs |
| 2 | **PiP 截帧链 100% 取不到画面** | 路由用 `{}` 调 screenshot（`core/petri-server/routes/computer-use.js:47`），而两侧 sidecar 都要求 `params.out` 必填（`sidecars/computer-use/Sources/petri-computer-use/InputController.swift:153`、`sidecars/computer-use-windows/AutomationService.cs:260`）；且两端返回 `{path,width,height,bytes}` / `{out,bytes,mode}` **均无 base64**，路由第 48 行只认 `pngBase64` → 恒 `frame_shape_unexpected`；macOS 另需先有 snapshot（`lastSnapshotPid`） |
| 3 | **`computer_close` 未暴露** | Windows sidecar 已实现 `close` 并列入 verbs（`AutomationService.cs:68,307`），但工具面只有 8 个、无 close；macOS 侧连 verb 都没有 |

附带的契约漂移（P3 一并清）：`computer_authorize` 元数据 `needsApproval/high` 与契约 R0 冲突（`core/petri-server/agent-tools/tool-metadata.js:152` vs `registry.js:342`）；`hwnd`/`summary` 实现消费但 schema 未声明（`computer-use-tools.js:44-56,126`）；`computer_wait` 契约 35000 / handler 40000 / sidecar 上限 30000 三处不一致。

测试基建事实：默认跑法下 `test/block48-computer-tools.test.mjs` 会因单例 sidecar 子进程不退出而挂到 180s watchdog 判 fail（逻辑本身 15/15 绿）——属"假红"，本包须让默认跑法为绿。

## §2 阶段与验收判据

### P1 控制类确认卡接入（阻断级，先做）

- 服务端：`needApproval/ackToken/toolJobId/toolId/message` 上抬改为**工具无关**（不再限定 `run_tool`），保持 `run_tool` 既有行为零回归。
- 前端：`pendingApproval` 生成条件去掉 `event.name === 'run_tool'` 硬编码；确认卡渲染不再与 `accessMode` 互斥（full 档反而必须能看见控制类确认）；批准/拒绝复用既有 `useApprovalFlow` → `/api/ai/run-tool-ack/:token` 与 `ackToolJob`。
- 判据：组件测试（控制类确认卡可渲染 + 批准/拒绝派发 + 非 full 档不误伤既有 run_tool 语义）；后端事件测试（`computer_click` 首调事件带 needApproval）。

### P2 PiP 截帧链修复

- 路由：传 `out`（主进程侧临时/项目内白名单路径，绝对 `.png`），帧回传改为「文件路径 → 主进程读盘转 data URL」或 sidecar 补 base64 二选一，取**改动最小且不破坏既有 screenshot 工具契约**的一条；两侧 sidecar 形状保持一致。
- macOS：无 `lastSnapshotPid` 时返回可解释引导（先 snapshot），不让 PiP 显示假帧。
- 判据：Node 测试覆盖「帧形状可用 + 无目标时诚实 error + 关窗即停采集」；实机 PiP 窗口打开后画面非空。

### P3 工具面与契约自洽

- 暴露 `computer_close`（Windows 走 WM_CLOSE；macOS 返回 `unsupported_verb` 诚实错误，不假装支持）；工具计数与 model-surface 预算基线同步。
- `computer_authorize` 元数据对齐 R0/只读/无审批；`hwnd`、`summary` 写进 schema（至少 snapshot/click/type/press/scroll/screenshot 的目标选择与说明）；`computer_wait` 超时收敛单源。
- 测试基建：单例 host 收尾，使 `node --test test/block48-computer-tools.test.mjs` 默认跑法为绿。

### P4 门禁化与收口

- 三条机械断言落库：①PiP 帧链可用（不得只测窗口生命周期）；②控制类必须有 UI 批准入口（源码/组件级契约）；③`computer_close` 在工具面。
- 定向测试 + `quality:types` + `quality:lint` + `docs:check` + `ui:audit:check` + 实机腿（dev Electron）+ closeout 十三门。

## §3 非范围（本包不做）

- 应用/窗口白名单、computer-use 总开关、composer 入口（对标项，需单独裁决）
- drag / 双击 / 右键 / hover / 移光标 / 剪贴板 / 多显示器
- Linux 平台实现
- `sidecars/computer-use-windows/` 二进制入库、签名与自动更新分发（G1+ 不外推）
- SimpleChat 会话主链重构（确认卡以最小接线接入，不重排主链）
- MCP 面暴露 `computer_*`（当前仅 agent 内置工具面，是否进 MCP 另裁）

## §4 依赖与环境纪律

- 依赖：无外部包依赖（零新 npm 依赖目标）；macOS 需屏幕录制 + 辅助功能权限（本机已授）；Windows 侧无二进制时保持诚实 `sidecar_not_built`。
- 环境：后端改动须重启 dev Electron；实机腿用隔离实例（9223 离屏），不在用户主窗留测试窗。
- 文件面隔离：BLOCK-344 在制（3D/SceneSpec），本包开工时须确认 344 已收口；本包零触碰 `frontend/src/components/model3d/**` 与 `core/petri-server/routes/model3d*`。

## §5 验收门禁清单（收口时逐项对账）

1. `node --test test/block48-computer-tools.test.mjs`（默认跑法，不加 `--test-force-exit`）全绿
2. `node --test test/block264-computer-use-pip.test.mjs` 含新「帧可用」用例全绿
3. `node --test test/block63-computer-host.test.mjs` + 前端 `ComputerUsePanel.test.tsx` + 新确认卡测试全绿
4. `npm run quality:types` 0 / `npm run quality:lint` 0 error
5. `npm run docs:check` + `npm run ui:audit:check` PASS（涉及 UI 面时台账同提交）
6. 实机：PiP 有真画面 + 控制类首调出确认卡 → 批准 → 执行落到 sidecar；证据落 `acceptance/block-345/`
7. `npm run closeout` 十三门 PASS

## §6 完成语义

`completed` 需同时满足：三处断链全绿、三条机械门禁在库、上述门禁逐项有当次证据。Windows 二进制缺席时保持诚实报错，不以 mock 冒充真机闭环；真机未覆盖的部分在收口笔录如实标注边界。

---

## §7 进度记录

- 2026-11-04 立项登记 `planned`（用户「可以的 开整」）；排队 BLOCK-344（active）之后。本日内只做立项文书，零产品代码改动。
