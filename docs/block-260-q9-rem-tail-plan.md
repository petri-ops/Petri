---
capability: q9-rem-tail
goal: Q9-REM 余项的可本地闭环切片——K3 退出摘要逐项查看、K2 本地 minidump 摘要（零上传）、C14 上下文感知追问；其余平台/G1+/产品决策项登记 reopen。
acceptance:
  - K3：退出摘要返回有界逐项定位（toolJob/task/subagentTask/approval），弹窗可「查看」并在取消退出后跳转对应结果面/会话；无项目项不渲染死按钮；不含参数正文。
  - K2：本地 MINIDUMP 只读摘要（头部/模块/异常/系统/进程）；畸形/截断/非文件 fail-closed；崩溃横幅显示摘要与详情；上传不做（G1+）。
  - C14：追问 chips 按内容关键词切换（结果/代码/失败/默认），本地启发式、不调用模型；仍只填输入框。
  - 测试 + types/lint/theme + test:changed；隔离 9223 亮/暗；closeout 十三门逐门取证；canonical 回写。
reopen: K1 应用级分段边界（产品定义）；K2 minidump 上传（G1+）；K3 逐项取消/停止（需要任务级取消协议）；K9 分步引导/数据导入（产品决策）；D1 低峰计价（provider 外部/G1+）/权限/缓存余项；D4 成本/复杂度/审计/覆盖确认；E7 macOS/PiP/真实 click-type（平台）；L3 浏览器连接器；L4 电脑控制余项。
status: completed
---

# BLOCK-260 · Q9-REM 余项：退出摘要逐项 + minidump 摘要 + 上下文追问

用户发令「搞定 Q9-REM 余项」（2026-10-25，承接 Jev 建议：先取 K3/K2 可本地闭环项）。

## 0. P0 余项对账

| 项 | 实况 | 处置 |
| --- | --- | --- |
| K1 应用级边界 | 页面/预览/轮次/工具已有；「应用级」无产品定义 | reopen |
| K2 minidump | 只列文件；无解析；上传=G1+ | **本包交付本地摘要**；上传 reopen |
| K3 退出摘要 | 只有计数 + 三选一；无逐项 | **本包交付逐项查看**；逐项取消/停止 reopen |
| K9 引导/导入 | 角色揭示已有；分步引导/数据导入未做 | reopen（产品决策） |
| D1 余项 | 价格已显示；低峰=provider 外部；权限/缓存部分 | reopen |
| D4 | Auto 选模已有；成本/复杂度/审计/覆盖确认未做 | reopen（产品策略） |
| E7 | Windows sidecar/probe 已有；macOS/PiP/真实动作未做 | reopen（平台） |
| C14 | 固定三条追问已交付（BLOCK-259） | **本包交付关键词上下文切换**；模型生成建议 reopen |
| L3/L4 | 无外部浏览器连接器 / 电脑控制余项 | reopen（平台/外部契约） |

## 1. 交付

- **K3**：`activity-summary` 增加有界 `items`（toolJob/task/subagentTask/approval，只含定位字段）；`desktop-shell-model.normalizeActivityItems` 脱敏/有界；`QuitSummaryDialog` 逐项「查看」；`DesktopShellProvider` 取消退出后导航到结果面/会话。
- **K2**：`src/main/minidump-summary.js` 纯解析器（头/模块/异常/系统/进程，零依赖、零上传、fail-closed）；`crashGuard.summarizeDump` + IPC `diagnostic:crash-dump-summary`；崩溃横幅显示摘要与详情。
- **C14**：`selectFollowupPrompts` 按结果/代码/失败关键词切换三组模板，未命中回默认。

## 2. 验收门禁

`node --test test/block260-*.test.mjs` + 前端定向（banner/dialog/messageActions）；`test:changed`；隔离 9223 亮/暗；closeout 十三门逐门取证。

## 4. 收口记录（2026-10-25）

| 项 | 交付 | 证据 |
| --- | --- | --- |
| K3 | `activity-summary` 有界 `items`（toolJob/task/subagentTask/approval，只含定位字段）；外壳归一丢弃未知 kind/字段有界/≤20；退出弹窗逐项「查看」；取消退出后跳结果面/会话。 | 后端契约 2/2 + 弹窗 5/5；实机 A3 |
| K2 | `minidump-summary` 纯解析器（头/模块/异常/系统/进程；零依赖零上传；畸形/截断/非文件 fail-closed）；`crashGuard.summarizeDump` + IPC；横幅摘要与详情。 | 解析器 4/4 + 横幅 3/3；实机 A4 |
| C14 | 追问 chips 按结果/代码/失败关键词切换，未命中默认；仍只填输入框。 | `messageActions` 12/12 + 行 3/3；实机 A2 |
| P4 | `test:changed` EXIT=0（changed=74；Node **1172**＝1159 pass/0 fail/13 skipped；前端 related 25 文件 **188** + 定向 106 文件 **743**）；types 0/lint 0 error/code-size PASS/knip 282；隔离 9223 亮/暗各 **14/14**（`acceptance/block-260/q9rem-tail-live{,-dark}.json`；截图 unavailable）；closeout **13/13 PASS** + `skills:check` OK。 | 见上 |

实机断言链：结果类会话 → 追问切「解释这个结果」→ 退出预览逐项 → 查看跳结果面 → 合成 dump 摘要（1 模块/x64/异常码）→ 详情（进程/线程/模块）。边界：synthetic 会话与 dump；截图 unavailable。

余项（reopen）：K1 应用级边界、K2 上传（G1+）、K3 逐项取消/停止、K9 引导/数据导入、D1 低峰/权限/缓存余项、D4 成本复杂度审计、E7 macOS/PiP/click-type、C14 模型生成建议、L3/L4。
