# BLOCK-452 · 更新 UX 自动推送（plan · completed）

## 收口笔录（2026-11-16）

**交付**：① `useAutoUpdate` 挂载即 check + 15min 轮询 + `visibilitychange→visible` 前台恢复 check，抽共享 `silentCheck`；② 查到新版本复用 Q9 `app:notify` 通道发系统通知一次（按版本 dedupeKey 去重，独立偏好 `notifyOnUpdates` 默认开，前台可见也弹）；③ 主进程 `NOTIFY_KINDS` + `allowWhenFocused` 例外 + 文案；④ 前后端类型同步。
**HK-01**：红=4 新测试失败（notify 0 次 / 轮询未触发）→ 绿=useAutoUpdate 18/18（原 14 + 新 4）；测试隔离用 cleanup + advanceTimersByTimeAsync(0) 修 test-only 污染，不改实现语义。block223 模型测试 10/10（新 update_available 用例 + 原回归）。
**门禁**：quality:types 0 红、新文件 eslint 0（修 react-hooks/set-state-in-effect error：mount check 推迟到 microtask）、ui:audit PASS、docs:check 592 PASS。
**实机**：9223 离屏 CDP 确认设置页 `?section=maintenance` 更新区在场、「检查更新」按钮可见；9223 跑完即 kill，dev 主窗保留。通知纯函数 10/10 覆盖白名单/前台例外/去重/偏好/文案。
**边界**：复用 app:notify 零新 IPC 通道；零新增依赖；零放宽基线；换标批 WIP 零触碰；未碰 Dock 弹跳/常驻胶囊/公证签名（非范围）。



> 发令：用户 2026-11-16「按照你的建议来 要测试 并且push」——采纳建议 1+2（定时轮询+前台恢复 check / 系统通知），要求测试并 push。
> 对标：`reference/ZCode`（启动 check + 空闲 15min/有更新 2min 轮询 + 左上角胶囊 + 菜单/托盘）、`reference/deepseek-harness`（10min 轮询 + OS 通知 + Dock 弹跳）。Petri 现状：仅启动 check 一次、仅设置页入口、无主动通知。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA 资格面。本包是更新 UX 打磨，非发布资格。

## 范围

1. **轮询 + 前台恢复 check**：`frontend/src/hooks/useAutoUpdate.ts` — 挂载 effect 加 `setInterval`（15 分钟，发现更新时收紧）+ `visibilitychange→visible` 触发 check；抽出共享 check 逻辑复用；卸载清理 interval/listener。模式抄 `ThemeProvider.tsx:206-212`。
2. **系统通知**：查到新版本时复用 Q9 `app:notify` 通道（`getBridge('app').notify({kind:'update_available',dedupeKey:version})`）——**不新增 IPC 通道**。
   - `src/main/desktop-shell-model.js`：`NOTIFY_KINDS` 加 `update_available`；`buildNotificationPayload` 补文案；`notificationDecision` 为该 kind 开"前台可见也弹"例外 + 独立偏好 `notifyOnUpdates`（默认 true）；保留免打扰/去重。
   - `frontend/src/lib/electron.d.ts`：notify kind union 加 `update_available`。
3. **测试**（HK-01 红绿先行）：`frontend/src/hooks/useAutoUpdate.test.ts` 补轮询/前台恢复/notify 调用用例；`test/*desktop-shell-model*` 补 update_available 白名单/前台例外/去重/偏好用例。

## 非范围（exclusions）

- Dock 图标弹跳（无现成封装，可选打磨）
- 设置页常驻更新胶囊按钮 / 菜单托盘入口（G1 打磨，另包）
- 公证 / 签名 / Provider 矩阵 / 自动静默安装（无 Developer ID，下载后仍手动拖入）
- 改 updater feed URL / SHA 校验逻辑（上包已上线）
- 换标批 WIP（19 图标 + desktop-shell.js + icon-tray.png）零触碰

## 验收门禁（预先声明）

| 门禁 | 预期 |
| --- | --- |
| HK-01 红绿 | 红=新测试因缺逻辑失败；绿=全部 PASS |
| useAutoUpdate 定向 | 原 14 + 新增轮询/前台/notify 用例全绿 |
| desktop-shell-model 定向 | update_available 用例全绿，原用例无回退 |
| quality:types | 0 红 |
| docs:check / ui:audit:check | PASS |
| 实机 | dev 栈可见主窗 + 设置页入口在场；通知决策纯函数实测 |

## 完成语义

测试全绿、类型/文档门禁绿、实机可见入口在场、零新增依赖/零放宽基线/零触碰换标 WIP，才标 completed。push 到 origin/main 后收口。

G0 开发期常态 · 不外推 packaged/Provider/GA。
