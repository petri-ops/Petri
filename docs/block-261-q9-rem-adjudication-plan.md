---
capability: q9-rem-adjudication
goal: 把 Q9-REM 十一项长尾余项逐条判档（本包交付 / G1+ 出籍 / 平台与外部条件 / 另立产品包），并交付判为「可最小协议交付」的两项——K3 退出摘要逐项取消/停止、K1 应用级错误边界；消除 §6.5 reopen 清单与 Q-MATRIX 行的漏记漂移。
acceptance:
  - 十一项逐条有实码证据（文件或路由）与四档归属；K4 余项漏记、K9「数据导入已有 preview 面」两处漂移同批纠正。
  - K3：退出摘要逐项可按 kind 触发停止/取消（toolJob→`/api/tools/cancel/:id`；task/subagentTask→`/api/ai/agent/task/:id/cancel`；approval→按其所属任务 `task/:taskId/cancel` 给「停止该任务」，无所属任务时禁用并说明原因；「拒绝/放行」仍只归审批卡，不在退出弹窗复制第二套决策面），复用既有端点不建第二执行器；失败原因如实回显（含 409 类）；无可停止项时不出死按钮。
  - K1：主窗与独立窗两棵树外层各有一道应用级边界（`surface=app`），壳层/Provider 渲染异常不再整窗白屏；路由级边界语义不变，嵌套时内层先兜。
  - 定向测试 + types/lint/theme + test:changed；隔离 9223 亮/暗；closeout 十三门逐门取证；canonical 回写（含 Q-MATRIX 机械重算）。
reopen: K9 分步引导与外部配置「应用面」/ C14 模型生成建议与自动润色 / D4 复杂度·成本·审计·覆盖确认 / D1 权限规则来源与定价缓存 / E7 PiP / K4 审批卡深度定位（均为另立产品包候选）；E7 macOS 与真实 click-type、L4 macOS sidecar、K4 OS 通知历史、D1 低峰计价（平台/外部条件）；K2 dump 上传（G1+ 阶段禁区）；L3 浏览器连接器（另立大产品包）。
status: completed
---

# BLOCK-261 · Q9-REM 余项逐条裁决与出籍（+ K3 逐项停止 / K1 应用级边界）

用户发令「先提交，完成 Jev 单一建议：Q9-REM 余项逐项裁决与出籍」（2026-10-25；Jev confidence=0.95）。

## 0. P0 逐条对账（十一项）

| 项 | 实码证据 | 判档 | 理由 |
| --- | --- | --- | --- |
| K1 应用级分段边界 | 五级中已有页面（`RouteErrorBoundary` 包 App.tsx 两棵路由树）/预览与轮次与工具（`SegmentBoundary`、BLOCK-248 Turn/ToolRowBoundary）；**壳层与 Provider 树外无任何边界** | **本包交付** | 纯健壮性工程，不需产品定义；「缺应用级」是可直接补的最后一档 |
| K2 崩溃同意/本地解析 | `crash-guard.js` `uploadToServer:false` + BLOCK-260 本地 MINIDUMP 摘要与横幅详情 | **行判 ✅；上传出籍** | 行定义=consent+本地解析，两者已完备；远程接收端属 G1+ 阶段禁区 |
| K3 退出/更新运行摘要 | BLOCK-260 逐项查看已交付；停止面其实早已存在：`/api/tools/cancel/:id`（owner 未证明即 409 fail-closed）、`/api/ai/agent/task/:id/cancel`（级联子 agent + 在途工具 abort）、`guard-ack`（requestId+deny 留痕） | **本包交付** | 缺的只是把既有端点接到逐项动作上，不建第二执行器 |
| K4 托盘/系统通知 | 应用内通知中心/点击跳转/开关/声音（BLOCK-223/226/259）已有；**OS 级通知历史由操作系统持有**；审批卡深度定位未做 | 拆两半：OS 历史=**外部条件**；审批卡定位=**产品包候选** | §6.5 第 11 行未列 K4 余项 → **漂移，同批补记** |
| K9 引导/数据导入 | 角色揭示（BLOCK-227）已有；`routes/external-import.js` 只有 `preview`（永不写盘），「应用」需逐键确认+回滚+审计 | **产品包候选（两个子面）** | 分步引导是产品形态决策；导入应用面是可最小交付但属独立契约，不塞进本包 |
| D1 模型选择器状态 | 目录/缺密钥/隐藏逐行（BLOCK-224）+ 价格显示（BLOCK-259）；低峰价=无本地电价源，属 provider 侧；Workspace 权限规则来源与定价缓存未做 | 低峰=**外部条件**；权限/缓存=**产品包候选** | 不自造第二套价格真值 |
| D4 自动选模型 | `frontend/src/lib/auto-model.ts` 无 complexity/costWeight/audit/override 任何实现（机械核对 0 命中） | **产品包候选** | 成本权重与审计可做但需与 Auto 语义一起定形 |
| E7 电脑使用画中画 | Windows sidecar/status/probe（BLOCK-229）已有；全仓无 PiP 实现；macOS 构建需 Mac 硬件；非交互桌面 UIA 实测 `target_not_found` | macOS·真实动作=**平台条件**；PiP=**产品包候选** | 硬件与桌面注入是外部前提，PiP 属形态决策 |
| C14 后续建议/润色 | BLOCK-259/260 交付有界模板 + 关键词切换；模型生成建议=需真实模型调用与发送语义裁决 | **产品包候选** | 自动改写触碰「不自动发送」红线 |
| L3 浏览器连接器 | `agent-tools` 无 `browser_*` 工具（0 命中）；仅 `BrowserPanel` UI | **另立大产品包** | 扩展 + native messaging 是整包体量；母纲红线=不复刻 Qoder SDK/端点 |
| L4 电脑控制 | Windows 侧已交付；macOS sidecar 未构建（需 Mac） | **平台条件** | 与 E7 同源外部前提 |

## 1. 交付范围

- **K3**：`frontend/src/lib/activity-control.ts` 单源映射（kind→既有端点 + 结果文案）；`QuitSummaryDialog` 逐项动作（ busy / 结果 / 失败原因并排，动作态随每次摘要重新出而清空）；`DesktopShellProvider` 只注入动作、不假设已停成；复用渲染侧既有 `getPlatformApiPrefix()` + `getToken()`，**不新增 IPC 通道、不新增端点**。
- **K1**：`RouteErrorBoundary` 增 `surface`（route/app 两套文案与 testid，单一实现不复制第二份边界）；`App.tsx` 主窗树与 `/window/*` 树各包一层应用级边界。
- **顺带修真（对账发现的缺陷）**：`approval-request-store.listPendingApprovals` 只读 `request.taskId`，而审批请求对象**从不带这个字段**（任务号存在于 `stores` 的键上）→ 退出摘要里的审批项 `taskId` 恒为 `null`，逐项停止无处下手。改为按 `stores.entries()` 迭代并以键兜底；`test/block261` 第 4 门钉住「审批项 taskId 与任务取消端点同一 id 空间」。
- 不做：新增端点、第二执行器、K4/K9/D1/D4/E7/C14/L3 的实现、G1+。

## 1b. 实机腿边界（如实登记）

- 覆盖：K3 逐项停止三态（已取消 / 归属未证明被拒且不谎称已停 / 已请求停止）+ 新摘要不携带旧结果 + 落库状态复核（pending→cancelled、无主作业仍 running、任务 `agent_status=cancel_requested`）。
- 不覆盖：审批项逐项停止（审批只活在后端内存 store，外部无法 seed）→ 由 Node 契约测试覆盖；K1 应用级边界（触发需真实渲染异常）→ 由组件测试覆盖（含嵌套时内层先兜）。报告 JSON 以 `notCoveredByLive` 字段留痕。

## 2. 验收门禁

`node --test test/block261-*.test.mjs` + 前端定向（`QuitSummaryDialog`/`RouteErrorBoundary`）；`test:changed`（含 impact-map 规则登记）；types/lint/theme；隔离 9223 亮/暗（合成 toolJob/task → 预览退出摘要 → 逐项停止 → 断言状态与原因回显）；closeout 十三门逐门取证。

## 3. 回写

Q-MATRIX 十一行逐行改写（K1/K2/K3 → ✅，其余 🟡 但列明归属档与证据），机械重算统计行；§6.5 第 11 行按四档重写；`pending-work-backlog` 登记产品包候选与平台项；UI 台账新增本批 UI 条目；handoff/roadmap/AUDIT-LOG 收口行。

## 4. 收口记录（2026-10-25）

| 项 | 交付 | 证据 |
| --- | --- | --- |
| P0 裁决 | 十一项逐条判档（四档：本包交付 / G1+ 出籍 / 平台与外部条件 / 产品包候选），每条带实码指针；纠正 §6.5 漏记 K4 余项、K9 未记 `external-import` preview 面两处漂移。 | 本文件 §0 + 母纲 §12 记录行 |
| K3 逐项停止 | `frontend/src/lib/activity-control.ts` 单源映射到既有 `/api/tools/cancel/:id` 与 `/api/ai/agent/task/:id/cancel`（零新端点、零新 IPC）；弹窗逐项动作 + 忙态 + 原位结果；`summaryVersion` 使旧结果不跟跑新一轮摘要。 | Node 契约 **6/6** + `activity-control` 9/9 + 弹窗 6/6（原 5/5 不回归）+ 实机 A2a/A2b/A2c/A3c |
| 顺带修真 | `listPendingApprovals` 按 `stores.entries()` 迭代并以键兜 `taskId`（此前恒空 → 审批项无法定位所属任务）。 | Node 契约第 4 门（审批 taskId → 取消端点同一 id 空间） |
| K1 应用级边界 | `RouteErrorBoundary` 增 `surface`（单一实现两套文案）；主窗树与 `/window/*` 树各包一层；嵌套时内层先兜。 | 组件 **5/5**（含 surface=app 与嵌套优先级）+ 实机 A5 反向守卫（正常链路不误触） |
| P4 门禁 | `test:changed` EXIT=0（changed=**27**；Node **717**＝712 pass/0 fail/5 skipped；前端 related 5 文件 **28** + 定向 54 文件 **359**）；types 0/lint 0 error/theme PASS/secret PASS/arch PASS/code-size PASS/arch-cycles PASS；knip 保留面 282→**283**（新 flow 动态入口留痕）；隔离 9223 亮/暗各 **18/18**（`acceptance/block-261/q9rem-adjudication-live{,-dark}.json`；截图 unavailable）；`npm run closeout` **13/13 PASS**。 | 见上 |

实机断言链：项目会话页 → 预览退出摘要（真实 seed 计数，非合成）→ 逐项行含排队作业/无主作业/运行任务 → 排队作业「取消」=「已取消。」→ 无主运行作业「取消」=「后端未能证明该作业的进程归属，已拒绝强制终止。」（不谎称已停）→ 任务「停止」=「已请求停止。」→ 真实「取消」动作收弹窗 → 再预览：已取消作业不再出现且旧结论不跟跑 → 落库复核（pending→cancelled / 无主仍 running / 任务 `agent_status=cancel_requested`）→ 收尾 `?test=1`。

余项（不再混写「未做」，按档另立项）：产品包候选=K9 引导与导入应用面、C14 模型生成建议与自动润色、D4 复杂度·成本·审计·覆盖确认、D1 权限规则来源与定价缓存、E7 PiP、K4 审批卡深度定位、L3 浏览器连接器；平台/外部条件=E7 macOS 与真实 click-type、L4 macOS sidecar、K4 OS 通知历史、D1 低峰计价；G1+ 出籍=K2 dump 上传。G0 开发期常态 · 不外推 packaged/Provider/GA。
