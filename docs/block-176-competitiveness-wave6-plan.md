---
capability: agent-competitiveness
goal: Agent 竞争力总纲 W6 波「协作与可靠性长尾」——CP-16 联邦委托事件流回传（peer SSE 订阅替代 5s 轮询，回退轮询保底）/CP-17 工作树 checkpoint 安全网（git stash create 快照+一键回滚，git 仓库工作空间）/CP-18 成本硬熔断（任务级预算上限→超限自动停机）/CP-19 数据桥 WS 化（投影数据桥 WS-first 回退 HTTP）
acceptance:
  - CP-16：委托期订阅对端任务事件流（SSE 解析失败/断流→回退轮询语义不变）；事件回写本地 task_events（委托留痕）
  - CP-17：checkpoint 创建/回滚 IPC 契约（git 仓库工作空间；非 git=诚实拒绝）；ReviewMode 安全网入口在场
  - CP-18：任务级成本上限（ai-settings costCapCny）超限自动 finalization 停机；设置面输入在场
  - CP-19：数据桥 WS-first 传输（既有 /m/api/ws 网关会话语义复用）+失败回退 HTTP 契约
  - closeout 门禁绿 + 总纲 §4 W6 行回写；双机依赖段（CP-16 跨机实测）按环境可得性如实分档登记
reopen: 任一 CP 出口断言未达即该 CP 返工；波内零停顿条款沿用（/goal 整波授权连续行使）
status: completed
---

# BLOCK-176 — 竞争力总纲 W6 波（协作与可靠性长尾）

## 0. 来源与授权

- 总纲：[`agent-competitiveness-program.md`](./agent-competitiveness-program.md) §4-W6（CP-16~19）。
- 用户授权：/goal「按照波次 逐个推进…不需要问我」整波授权连续行使（W1~W5 先例）。
- 环境分档纪律：CP-16 跨机实测段=双机环境依赖，本机以 mock 对端契约测试+单机冒烟分档登记；其余 CP 全实机可达。

## 1. 范围

- **CP-16 联邦事件流回传**：federation-tools 委托运行期订阅对端 `/api/ai/agent/task/:id` SSE（配对 token 鉴权沿用），关键事件（iter/done/failed）回写本地 task_events；SSE 断流/不支持→回退既有 5s meta 轮询（语义不变）。
- **CP-17 工作树安全网**：新 IPC checkpoint/rollback——git 仓库工作空间 `git stash create` 快照（无副作用）+ref 登记；回滚=按登记 ref 恢复跟踪文件；非 git/无变更=诚实拒绝。ReviewMode 工具栏「安全网」入口。
- **CP-18 成本硬熔断**：ai-settings `costCapCny`（任务累计成本上限，¥）；agent-runner 每轮终查 ai_usage 累计→超限走既有 finalization 停机；设置面（用量节）输入。
- **CP-19 数据桥 WS 化**：projectionDataBridges 的数据读取走既有 /m/api/ws 网关 WS-first（信封复用 BLOCK-162 会话语义），3 连失败/未连→自动回退 HTTP（现状语义）。

## 2. 非范围

- 双机联邦跨机实测（环境分档）；非 git 工作空间快照；成本预算跨任务聚合报表；数据桥服务端协议扩展。

## 3. 门禁与完成语义

每 CP：定向红绿+tsc+lint。波末：closeout 十三门+实机探针（单机可达段，acceptance/block-176/）+UI 台账。出口全过（含分档登记）+closeout 绿=completed；总纲 §4 W6 行回写。

## 4. 波报（2026-10-12 收口）

- **CP-16 联邦事件流回传**：federation-tools `mirrorPeerTaskEvents`（对端任务 SSE 订阅→非 delta 事件镜像本地 task_events 带 peerName 留痕；delta 跳过、坏帧容忍、断流静默回退轮询）。**契约测试抓真**：`require('../../agent-task-store')` 误路径（agent-tools 下应为 `../`）致镜像一进 try 即 MODULE_NOT_FOUND 被静默吞——死缺陷修复后契约 2 项绿。跨机实测段=双机环境依赖分档（mock 对端契约承载，plan §0 授权）。
- **CP-17 工作树安全网**：helper 迁 `core/shared-backend/workspace-checkpoint.js`（R5 只禁 core/petri-server，shared-backend 放行=git-adapter 先例；src/ipc 与 core 两侧同源消费，零复制）；IPC `git:checkpoint-create/rollback` 双侧登记+类型面；ReviewMode 工具栏「快照/回滚快照」（回滚=confirm 二次确认+refresh 重投影）。契约 4/4（真实临时仓）。
- **CP-18 成本硬熔断**：cost-cap 纯函数面（sanitize/resolve env 覆盖优先/isExceeded）+ route GET/PUT + **执行面补齐**：loop-orchestrator 每轮查 conversation 维度 ai_usage 累计→超限推 capHit 同型诚实收尾提示+`cost_cap_exceeded` 事件遥测（costCapAnnounced 防重复；未配置=null 零行为变化；读取失败 fail-open）；设置面（用量节）costCapCny 输入块。契约 4 项。
- **CP-19 数据桥 WS 化**：**deferred（本波不实施）**——投影数据桥传输层协议变更为移动栈跨端契约面，宜新会话整段设计（WS 网关会话语义复用面+回退HTTP 双端联测），不随本波长尾批次夹带；既有 HTTP 投影通道语义不变。总纲 §4-W6 行以 deferred 如实登记，不开 reopen（非出口断言未达，属范围裁决）。
- **实机探针**：w6-live 8/8 PASS（acceptance/block-176/w6-live.json）；CP-18 HTTP roundtrip 分档=运行中后端进程早于路由（HTML fallback），重启后复测即绿，契约+源码级已绿。
- **收口抓真链**：eslint 化石抑制 2 条收缩（UI-502 hooks 修复后失效）→ knip 死导出 `viewerProfileCanCompare` 删除（UI-505）→ ReviewMode.block41 1 红=bisect 干净树同红（存量归因，非本批引入）。
- **随批缺省裁决**：ReviewMode 安全网钮置「全部还原」左侧（破坏性动作前置安全网动线）；cost-cap 设置面置用量节底部（读面同屏对照）；loop 熔断提示文案与 capHit 分支同型（诚实收尾不虚报完成）。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
