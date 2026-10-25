---
capability: q9-rem-slice
goal: Q9-REM 长尾 P0 逐项对账，并交付本地可验证的最小切片——K4 通知中心点击/类型开关/声音、C14 建议追问/润色、D1 模型价格显示；其余项按平台/G1+/产品决策登记 reopen。
acceptance:
  - K4：通知条目可点击（标已读并跳项目会话/计划看板）；四类通知类型开关 + 声音开关持久化；关闭类型不再入本地历史。
  - C14：助手消息「润色/建议追问」只在用户点击后把有界文本填入输入框，不自动发送；无回调不渲染死按钮。
  - D1：`/api/ai/pricing` 与 `ai-usage.AI_PRICING` 单一源；模型菜单展示 input/output 单价，发现失败时原因与价格同时显示；取不到不猜价。
  - 定向测试 + types/lint/theme + test:changed；隔离 9223 亮/暗；closeout 十三门逐门取证；canonical 回写。
reopen: K1 应用级边界（产品定义）；K2 minidump 解析（上传=G1+）；K3 退出摘要逐项操作；K9 分步引导/数据导入（产品决策）；D1 低峰计价（provider 外部/G1+）/权限/缓存余项；D4 成本/复杂度权重/审计/覆盖确认；E7 macOS/PiP/真实 click-type（平台）；C14 上下文感知建议/自动润色；L3 浏览器连接器；L4 电脑控制余项；G1+。
status: completed
---

# BLOCK-259 · Q9-REM 最小切片：通知中心 + 建议/润色 + 模型价格

用户发令「行 搞完这个」（2026-10-25，承接 Jev 建议：先 P0 逐项对账，再取最小切片）。

## 0. P0 逐项对账（2026-10-25）

| 项 | 实况 | 处置 |
| --- | --- | --- |
| K1 应用级边界 | 轨迹事件已有 turn/tool 分组与筛选；「应用级」事件边界无产品定义 | reopen（等定义） |
| K2 minidump 解析/上传 | `crash-guard` 只列 dump 文件名/大小/时间，不解析；上传属 G1+ | reopen（本地解析成本中、实机取证弱） |
| K3 摘要逐项操作 | 退出摘要只有计数 + 取消/托盘/停止；无逐项打开/停止 | reopen（主/渲染协议扩展） |
| K4 通知点击/历史/审批穿透/声音/类型开关 | 通知中心只有列表 + 全部已读/清空；点击/类型开关/声音未做 | **本包交付** |
| K9 分步引导/数据导入 | 首启角色揭示已有；分步引导/数据导入未做 | reopen（产品决策） |
| D1 低峰/权限/价格/缓存 | 价格表已在 `ai-usage.AI_PRICING`，选择器不显示；低峰=provider 外部能力；权限/缓存已有部分 | **价格显示交付**；余项 reopen |
| D4 成本/复杂度/审计/覆盖确认 | Auto 选模已有（BLOCK-225）；权重/审计/覆盖确认未做 | reopen（需产品策略） |
| E7 macOS/PiP/真实 click-type | Windows sidecar/status/probe 已有；PiP/macOS/真实动作未做 | reopen（macOS 需 Mac；平台 GUI） |
| C14 后续建议/润色 | 仅 GenUI follow-up；无消息级建议/润色 | **本包交付最小形态**；上下文感知/自动润色 reopen |
| L3 浏览器连接器 | 无外部浏览器连接器 | reopen（需外部扩展/CDP 契约） |
| L4 电脑控制余项 | 平台相关动作未做 | reopen（平台） |

## 1. 非范围

- 不做 K2 上传、D1 低峰计价、E7 macOS/PiP 真实动作、L3/L4 平台能力。
- C14 不做模型自动生成建议/自动改写；仅用户显式点击后填入输入框。

## 2. 交付

- **K4**：`notification-center` 增加类型/声音偏好与 `noticeTarget`；铃铛条目可点击（已读 + 跳转），面板加四类开关与声音开关。
- **C14**：消息动作注册表加 `polish` / `suggest-followups`；润色模板 4000 字有界；三条固定追问 chips；只填输入框不发送。
- **D1**：`GET /api/ai/pricing`（单一源 `AI_PRICING`）；`ModelMenu` 拉取并在模型行显示 `¥input/¥output 每 1M`，发现失败时原因+价格并存。

## 3. 验收门禁

`node --test test/block259-*.test.mjs` + 前端定向（notification/ModelMenu/messageActions/row）；`test:changed`；隔离 9223 亮/暗；closeout 十三门逐门取证。

## 4. 收口记录（2026-10-25）

| 项 | 交付 | 证据 |
| --- | --- | --- |
| K4 | `notification-center` 类型/声音偏好 + 单条已读 + `noticeTarget`；铃铛条目可点击跳转；四类开关与声音开关落 localStorage，关闭类型不入历史。 | `notification-center` 8/8 + `NotificationCenterBell` 5/5；实机 A5/A6 |
| C14 | 消息动作「润色/建议追问」；润色 4000 字有界；3 条固定追问 chips；只填输入框不自动发送；无回调不渲染死按钮。 | `messageActions` 11/11 + 行 3/3 + hook 3/3；实机 A2/A3 |
| D1 | `GET /api/ai/pricing`（单一源 `AI_PRICING`）；模型菜单价格；发现失败时原因+价格并存；取不到不猜价。 | 后端 1/1 + `ModelMenu` 6/6；实机 A4 |
| P4 | `test:changed` EXIT=0（changed=52；Node **803**＝794 pass/0 fail/9 skipped；前端 related 22 文件 **176** + 定向 96 文件 **688**）；types 0/lint 0 error/code-size PASS/knip 281；隔离 9223 亮/暗各 **11/11**（`acceptance/block-259/q9rem-live{,-dark}.json`；截图 unavailable）；closeout **13/13 PASS** + `skills:check` OK。 | 见上 |

实机断言链：合成会话 → 润色填输入框 → 追问 chips 填输入框 → 模型价格（原因+价格并存）→ 首页通知点击回项目会话 → 类型开关落盘。边界：截图 unavailable；会话为合成 seed。

余项（reopen）：K1 应用级边界、K2 minidump 解析、K3 退出摘要逐项操作、K9 引导/数据导入、D1 低峰/权限/缓存余项、D4 成本复杂度审计、E7 macOS/PiP/click-type、C14 上下文感知建议/自动润色、L3 浏览器连接器、L4 电脑控制余项。
