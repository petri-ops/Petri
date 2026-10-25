---
capability: q5-rem-tail
goal: 收掉 Q5-REM 尾包三项——底部终端打开后宿主菜单无法再弹出（壳层 bug）、E9 终端分屏（双 pane 独立标签/会话）、F7 钉住/最大化实机腿；E1 跨宿主 DOM 合并另立设计包，不在尾包里硬塞。
acceptance:
  - 宿主菜单：打开底部终端后再次点击「更多工具」菜单可见可交互，终端关闭/再开不复发；补回归测试。
  - E9：底部终端支持双 pane 分屏；两个 pane 可显示不同 tab、各自 xterm/pty 会话独立；关闭/上限/焦点/退出分屏行为可断言；单 tab 时开启分屏自动补一个 tab。
  - F7：真实/合成结果链钉住后，主区最大化/副栏最大化/恢复分屏可用；恢复后比例不变；隔离 9223 实机取证。
  - 定向测试 + types/lint/theme + test:changed；隔离 9223 亮/暗；closeout 十三门逐门取证；canonical 回写。
reopen: E1 跨宿主 DOM 合并（另立设计包）；通用 pane 模型（跨 terminal/sidechat/right rail）；终端分屏的拖拽比例/三 pane/会话恢复；G1+。
status: completed
---

# BLOCK-257 · Q5-REM 尾包：宿主菜单 + E9 终端分屏 + F7 钉住实机

用户发令「搞定 Q5-REM」；范围裁决：**尾包三项，E1 跨宿主合并另立设计包**（2026-10-25）。

## 0. P0 对账

| 项 | 实况 | 结论 |
| --- | --- | --- |
| 宿主菜单 bug | `useWorkspaceTitleBar` 把宿主入口（模式/终端/侧聊）放进「更多工具」；打开终端后菜单无法再次弹出（BLOCK-253 实机观察，未修壳层） | 先实机复现定位（壳层堆叠/菜单状态/终端覆盖），再修 |
| E9 终端分屏 | `BottomTerminal` 单 pane + 多 tab；`useTerminalTabs` 只 ensure active tab；母纲曾 deferred | 加双 pane 分屏，复用现有 xterm/pty，不建第二终端栈 |
| F7 钉住实机 | `ArtifactPinPane` 最大化/恢复有 6/6 组件测试；无钉住实机腿 | 用合成结果链钉住 → 主/副最大化 → 恢复，补实机证据 |
| E1 跨宿主渲染合并 | 中心模式/底部终端/侧聊仍各宿主；BLOCK-253 只统一入口 | **另立设计包**，本包不碰 |

## 1. 非范围

- 不做 E1 跨宿主 DOM 合并（另立）。
- 不做通用 pane 模型（跨 terminal/sidechat/right rail）。
- 不做终端三 pane/拖拽比例/会话恢复；不做 G1+。

## 2. 阶段

P1 宿主菜单 bug（复现 → 修 → 回归测试）；P2 E9 分屏（hook 支持 secondary session + BottomTerminal 双 pane + 测试）；P3 F7 实机（复用合成结果链）；P4 门禁/实机/closeout/canonical。

## 3. 验收门禁

`node --test test/block257-*.test.mjs`、前端定向 `BottomTerminal/terminalTabs/…`、`test:changed`、types/lint/theme、隔离 9223 亮/暗、closeout 十三门逐门取证。

## 4. 收口记录（2026-10-25）

用户发令「搞定 Q5-REM」，范围裁决=尾包三项、E1 另立。

| 项 | 交付 | 证据 |
| --- | --- | --- |
| P1 宿主菜单 bug | 根因=「更多工具」菜单留在 titlebar 容器内，受列级 header 的 `overflow`/层叠裁切；修法=`createPortal` 到 `document.body` + `position: fixed`（按「+」按钮 rect 计算 top/right），遮罩同 portal。回归测试锁定「菜单父节点必须是 body、容器内不得存在菜单」。 | `TitleBarRightZone.tsx`；`TitleBarRightZone.toolMenu.test.tsx` 2/2 |
| P2 E9 终端双 pane | `useTerminalTabs` 支持 `secondaryId`：active + secondary 两个 tab 同时 ensureSession，ResizeObserver 按可见 host 集合 fit；`BottomTerminal` 增加分屏 toggle（第二 tab 同屏、无第二 tab 时自动补开并保留原 active、点分屏 tab 交换两栏、关闭/切换自动收敛）。 | `useTerminalTabs.test.ts` 10/10；`BottomTerminal.split.test.tsx` 2/2 |
| P3 F7 钉住实机 | 合成完成 job（`tj_q5rem_tail` + `deg.csv`）经 `/project/:id/result?job=…&artifact=deg.csv` 打开结果面 → 钉住 → 主区最大化 → 恢复 → 副栏最大化 → 恢复（分屏 + 比例槽在场）。 | `acceptance/block-257/q5rem-live.json` / `q5rem-live-dark.json`，亮/暗各 **17/17**（截图 `unavailable`） |

实机断言链：A0 健康/root → A1 更多工具菜单 → A2 菜单点「终端」打开 → A3 终端打开后菜单复开（bug 回归）→ A4 新 tab + 分屏两个 host 可见 → A5 钉住/主最大化/恢复/副最大化/恢复 → A6 收尾回 `?test=1`。

静态与定向：`quality:types` 0、`quality:lint` 0 error、`test:changed` EXIT=0（changed=25；Node **97** tests＝95 pass / 0 fail / 2 skipped；前端 related 26 文件 **202** + 定向 37 文件 **297**）；closeout **13/13 PASS** + 报告门 `skills:check` OK。Knip 基线因新增动态入口 flow `q5rem-tail-live.cjs` 按规则 `--update`（278→279 键，仅该一条）。

边界：截图离屏 `unavailable`；结果链为合成 job（只验钉住/最大化 UI，不外推真实分析）；E1 跨宿主 DOM 合并与通用 pane 模型不在本包。
