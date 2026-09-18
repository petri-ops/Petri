# BLOCK-85 双真机端到端验收 Runbook（Windows ↔ Mac）

> 用途：BLOCK-85 格物联邦最后一步——双真机端到端验收。本文件随仓库同步，
> Mac 侧会话 pull 后按此执行；完成后整包 completed 并解锁 BLOCK-88 P1（D7 门槛）。
> 前置状态：P1-P3 已交付 + P4 closeout 四门绿（2026-09-18，1d014a39）；联邦探针 3/3。

## 0. 两端准备

**Windows 端（指挥席/执行端，本机）**：
- dev 栈已在跑（后端 :3001 + 网关 :3005 LAN 可达，LAN IP 以启动日志 `📱 [mobile-gateway] listening` 为准，曾为 192.168.0.102）。

**Mac 端**：
```bash
git pull                      # 确保 = origin/main（cc857450 或更新）
BIOF3_MOBILE_ENABLED=1 npm run dev   # 启动 dev 栈 + 网关（联邦 REST 挂在网关会话门内）
```
- 网关启用判据：启动日志出现 `📱 [mobile-gateway] listening on 0.0.0.0:3005`。
- 两端须同一局域网；记录 Mac 的 LAN IP（启动日志同款行）。
- P2 需要 Mac 有 R 运行时（真实分析作业）；P3 需要 Mac 有 chat 模型凭据（DeepSeek）。
- 防火墙放行 3005（macOS 首次监听会弹授权）。

## 1. P1 配对双端通（任一端发起，D8 对称）

推荐：**Mac 发起配对码 → Windows 兑换**（Windows 侧 UI 路径已实机验证过）。
1. Mac：设置 → 联邦（协作节点）面板 → 挂载即自动出码（配对链接含 token，TTL 5 分钟、4 分钟自动续码）。
2. Windows：设置 → 联邦 → 粘贴 Mac 的配对链接 → 「已添加协作节点」+ probe 握手绿灯。
3. 断言：两端节点列表互相可见、`GET /federation/peers` 在线状态在线；任意一端可即时吊销（吊销后对端 401）。
- 证据：两端面板截图 + peers JSON 落 `acceptance/block-85/dual-p1-pairing.png|json`。

## 2. P2 真实分析作业跨机跑通

诚实边界：执行位置选择器 UI 第三态「格物节点」**未接入**（P2.5 已侦察三处实施点，独立小批）——本步走 REST 直提 `executionTargetId=fed:<peerId>`（与 UI 接入同一条后端链，tools-executor.js:1654 分派分支）。
1. Windows 获取 peerId：`GET http://127.0.0.1:3005/federation/peers`（会话门内，Authorization 用网关会话）。
2. Windows 提交作业到本机 `POST /api/tools/run`，`executionTargetId: "fed:<peerId>"`，toolId 选 Mac 可跑的分析（deseq2 或 volcano-plot——**注意**：Mac 侧插件集需含该工具；biof3 R 作业需 Mac R 运行时就绪）。
3. 断言：Windows 侧镜像 job 状态投影流转 → 终态 completed；Mac 侧 tasks 表有真值记录；产物留在 Mac（Artifact Truth 在执行端）。
- 证据：`acceptance/block-85/dual-p2-job.json`（Windows 侧 job 快照 + Mac 侧 task id）。

## 3. P3 真实模型委托跑通

1. Windows 聊天（完全访问档）：「把下面任务委托给协作节点执行：……」——agent 调 `delegate_to_gewu_node(peerId, task, timeoutMinutes)`。
2. 断言：Mac 开独立 agent 会话执行（Mac 端任务列表可查）；Windows 会话收到委托单+流式回执+终态摘要。
- 证据：`acceptance/block-85/dual-p3-delegate.json`（Windows 侧工具回执 + Mac 侧 task_events 摘要）+ 截图。

## 4. 完成后回写

- 三步全过 → 本文件状态改「整包 completed」+ DOC-REGISTRY/roadmap/handoff 同步 + AUDIT-LOG ✅。
- BLOCK-88 P1 解锁（D7 门槛满足），P0 八项裁决已备（`docs/block-88-engineer-collab-p0-design-review.md` §8）。
- 任一步失败：如实登记失败点与两端日志，勿静默降级；联邦协议面小，可按错误码表（federation_session_invalid 409 / run_failed 502 / unreachable 504）定位。

## 已知注意

- 两端版本不同步会导致协议兼容风险——**Mac 必须先 `git pull` 到与本文件同一提交**。
- 网关关闭态 = 联邦不可达（unreachable 504），先查两端启动日志的 3005 行。
- Windows 端 LAN IP 会变（DHCP）：配对链接里的地址以**发起端当下**启动日志为准。
