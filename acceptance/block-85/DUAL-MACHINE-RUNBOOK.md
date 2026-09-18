# BLOCK-85 双真机端到端验收 Runbook（Windows ↔ Mac，跨网段 aliyun 模式）

> **状态：✅ 双真机验收 completed（2026-09-18 夜，Windows 侧会话主导 + Mac 侧配合）**。
> P1 配对（probe 穿 aliyun 绿灯 175ms）+ P2 fed 分析作业（desq2 demo 在 Mac 10s completed，
> 产物真值 `/Users/.../results/tool-jobs/`，Windows 零拉回）+ P3 delegate 委托（Mac agent
> 独立执行 system_info 侦察，回执 success + 指纹回流）。证据：`acceptance/block-85/dual-p*.json`。
> 验收过程顺修两缺陷（job-provenance require 断链 ee317893 / delegate 终态 done≠completed），
> 登记两结构缺口（delegation 无项目绑定 → project_required；委托未开独立会话 → 历史污染）归 BLOCK-88 域。
>
> 用途：BLOCK-85 格物联邦最后一步——双真机端到端验收。本文件随仓库同步，
> Mac 侧会话 pull 后按此执行；完成后整包 completed 并解锁 BLOCK-88 P1（D7 门槛）。
> 前置状态：P1-P3 已交付 + P4 closeout 四门绿（2026-09-18，1d014a39）；联邦探针 3/3。

## 0. 网络机制与两端准备

**跨网段机制（2026-09-18 实测确认）**：两端不在同一网段 → 配对/握手/作业/委托全部经
aliyun 中转，**不走局域网直连**。每端各自启用 mobile-gateway（:3005）+ aliyun 反向
隧道（SSH -R）；隧道 connected 时配对链接 primaryUrl 自动升级为公网形态
`https://<publicUrl>/pair?token=…`（mobile-admin.js `pairingUrlsFor`）。联邦对端注册
即用对端的公网 URL，握手与回传穿 aliyun。

**Windows 端（已就绪，2026-09-18 实测）**：
- 网关 enabled :3005（bind 0.0.0.0）+ 隧道 enabled（host=aliyun，publicUrl=
  `https://47.110.228.168`；配置在 `.biof3-dev-user-data/data/mobile/tunnel.json`）。
- 公网可达性实测：curl `https://47.110.228.168/api/mobile/status` → 401 session_invalid
  （穿 aliyun 到达本机网关，会话门正常）。
- dev 栈在跑（数据面 `.biof3-dev-user-data/data`）。

**Mac 端**：
```bash
git pull                      # 确保 = origin/main（bffd97c5 或更新）
BIOF3_MOBILE_ENABLED=1 npm run dev   # 启动 dev 栈 + 网关（联邦 REST 挂在网关会话门内）
```
- 网关启用判据：启动日志出现 `📱 [mobile-gateway] listening on 0.0.0.0:3005`。
- **Mac 需要自己的 aliyun 隧道**（不能与 Windows 共用 publicUrl——47.110.228.168 的
  443 反代已映射 Windows）：设置 → 手机同步 → 隧道配置，填 aliyun SSH 与 Mac 自己的
  映射/公网 URL。若 aliyun 侧还没有 Mac 的映射（443 已被 Windows 占用），需先在
  aliyun 服务器加一条独立反代（如 :8443 → aliyun 本地对应端口）——aliyun 侧操作归
  用户（SSH 在手）。
- Mac 隧道就绪判据：设置页隧道状态 connected。
- P2 需要 Mac 有 R 运行时（真实分析作业）；P3 需要 Mac 有 chat 模型凭据（DeepSeek）。

## 1. P1 配对双端通（跨网段：用对端公网配对链接）

推荐：**Mac 发起配对码 → Windows 兑换**（Windows 侧 UI 路径已实机验证过）。
1. Mac：设置 → 联邦（协作节点）面板 → 挂载即自动出码；隧道 connected 时出码的
   primaryUrl 即 Mac 公网形态（`https://<mac-publicUrl>/pair?token=…`）。
2. Windows：设置 → 联邦 → 粘贴 Mac 的**公网配对链接** → 「已添加协作节点」+ probe
   握手绿灯（握手请求经 aliyun 到达 Mac）。
3. 断言：两端节点列表互相可见、`GET /federation/peers` 在线状态在线；任意一端可即时
   吊销（吊销后对端 401）。
- 证据：两端面板截图 + peers JSON 落 `acceptance/block-85/dual-p1-pairing.png|json`。

## 2. P2 真实分析作业跨机跑通

诚实边界：执行位置选择器 UI 第三态「格物节点」**未接入**（P2.5 已侦察三处实施点，独立
小批）——本步走 REST 直提 `executionTargetId=fed:<peerId>`（与 UI 接入同一条后端链，
tools-executor.js:1654 分派分支）。
1. Windows 获取 peerId：`GET http://127.0.0.1:3005/federation/peers`（会话门内）。
2. Windows 提交作业到本机 `POST /api/tools/run`，`executionTargetId: "fed:<peerId>"`，
   toolId 选 Mac 可跑的分析（需 Mac 插件集含该工具 + R 运行时就绪）。
3. 断言：Windows 侧镜像 job 状态流转 → 终态 completed；Mac 侧 tasks 表有真值记录；
   产物留在 Mac（Artifact Truth 在执行端）。
- 证据：`acceptance/block-85/dual-p2-job.json`（Windows 侧 job 快照 + Mac 侧 task id）。

## 3. P3 真实模型委托跑通

1. Windows 聊天（完全访问档）：「把下面任务委托给协作节点执行：……」——agent 调
   `delegate_to_gewu_node(peerId, task, timeoutMinutes)`。
2. 断言：Mac 开独立 agent 会话执行（Mac 端任务列表可查）；Windows 会话收到委托单 +
   流式回执 + 终态摘要。
- 证据：`acceptance/block-85/dual-p3-delegate.json`（Windows 侧工具回执 + Mac 侧
  task_events 摘要）+ 截图。

## 4. 完成后回写

- 三步全过 → 本文件状态改「整包 completed」+ DOC-REGISTRY/roadmap/handoff 同步 +
  AUDIT-LOG ✅。
- BLOCK-88 P1 解锁（D7 门槛满足），P0 八项裁决已备
  （`docs/block-88-engineer-collab-p0-design-review.md` §8）。
- 任一步失败：如实登记失败点与两端日志，勿静默降级；联邦协议面小，可按错误码表
  （federation_session_invalid 409 / run_failed 502 / unreachable 504）定位。

## 已知注意

- 两端版本不同步会有协议兼容风险——**Mac 必须先 `git pull` 到与本文件同一提交**。
- 网关/隧道任一关闭 = 对端 unreachable（504）；先查两端启动日志的 3005 与
  mobile-tunnel 行。
- 隧道断线自愈在管理器内（退避重连）；长时间 unreachable 时先看两端隧道状态。
- Windows 端 publicUrl `https://47.110.228.168` 已被本机映射占用——Mac 必须用 aliyun
  上独立映射，不得复用同一 publicUrl。
