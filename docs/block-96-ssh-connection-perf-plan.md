# BLOCK-96-SSH-CONNECTION-PERF — SSH 远端连接性能与韧性加固

> **⛔ superseded（2026-09-16 撞号对账）**：本登记与 [BLOCK-96-SSH-CHANNEL-PERF](./block-96-ssh-channel-perf-plan.md)（同日并行推进并整包收口 completed）撞号。对账结论：W1 跨操作连接复用 / W2 长连接保活 / W3 重试编排 / W4 重试增强已由彼包兑现（__mux 跨操作复用实测 15ms RTT、ServerAliveInterval=15 保活、mux 幂等只读透明重试、pidfile/进程组击杀；本文件前提「每操作新建握手 ~1s」「零保活」为过时判断）；W5 部分（probe 握手计时黑洞提示）、W6 部分（RemoteTargets 首连提示）亦已交付。**残余候选保留于本文件**：ProxyJump 高级参数、探测熔断编排（**连接状态徽标已销号**——UI-397 SSH 呼吸灯 SshStatusDot 三态〔绿呼吸/黄快闪/红常亮〕+点击重试完整覆盖「连接状态可见」，2026-09-18 L4-2 收尾批登记）——重启需用户裁决并重新查号。本文件不再作为 canonical 执行依据。

最后更新：2026-09-16（superseded 横幅：撞号对账并入 BLOCK-96-SSH-CHANNEL-PERF completed）

状态：`superseded（2026-09-16 撞号对账 → 并入 docs/block-96-ssh-channel-perf-plan.md completed；残余候选见上方横幅）`

计划编号：`BLOCK-96-SSH-CONNECTION-PERF`

用户裁决原话：「如果没有的话 我觉得 可以新开一个block 这个性能上是需要优化的」（2026-09-16；前置对话=SSH 远端连接的延迟/韧性核对，用户据此裁决立项）。

主模块：`core/biof3-server/helpers/remote-execution/`（ssh-transport / remote-job-runner / node-agent / error-classifier）+ `core/biof3-server/helpers/workspace-gateway.js`（部署校验缓存）+ 远端连接状态呈现面（落点 P0 评审定）

关联：BLOCK-57-REMOTE-EXECUTION（通道层权威，本包只做增量不重开其 D1–D9 裁决）；BLOCK-67-SSH-REMOTE-PROJECT（远程项目形态 + D2 体感预算 P50≤1.5s / D5 断线诚实）；BLOCK-76-SSH-NATIVE-EXECUTION；BLOCK-89/90/91（远程文件面能力，本包不动其语义）；BLOCK-39-AGENT-STREAM-RECONNECT（**设计模式先例**：游标续传 + 断线重建，本包把同款思路用于 SSH 长流）；BLOCK-78（sys_resource 远程监测面）。

## 0. 立项依据（2026-09-16 代码核对结论）

会话内核对确认：**连接加固没有专门的包**，现有韧性是 BLOCK-57/67/76/89/90/91 各自顺手做进去的；planned 队列（BLOCK-92/93/94/95）与本主题无关。核对同时确认「底子不差、最大杠杆缺失」：

| 领域 | 现状 | 位置 |
| --- | --- | --- |
| SSH 参数 | 仅 `BatchMode=yes` + `ConnectTimeout=10`（fail-fast，不悬挂） | `remote-execution/ssh-transport.js:24-33` |
| 单操作超时 | 默认 30s + SIGKILL + `timer.unref()` | `ssh-transport.js:47-51` |
| 错误分类 | `transport.network / timeout / unknown / ok` + `retryable` 字段 | `remote-execution/error-classifier.js` |
| 重试 | 3 次、**线性递增退避**（1200ms×n）、**按 retryable 门控**（已优于常见实现） | `remote-job-runner.js:32-40` |
| 单次操作内复用 | `__mux` 单连接循环（stdin 每行 = base64 命令，回送 exit+stdout） | `node-agent.js:118-134` |
| agent 部署 | 远端 `sha256sum` 比对 → 不一致才重传；脚本经 stdin 灌入（无临时文件） | `remote-job-runner.js:44-70` |
| 部署校验缓存 | `ensuredAgents` 模块级 Set（键 `alias:agentHash`），消除每请求 ~1s 重复校验 | `workspace-gateway.js:36-49` |
| 断线真相 | 作业真相落**远端** `state.json` / `exit.json`（连接断开不丢状态） | BLOCK-57 D1 |
| 偏移续读 | `log <jobId> <offset>` 字节偏移续读；`fs_read <path> [off] [len]` | `node-agent.js:12,19` |
| 写入幂等 | `fs_write` tmp+mv 原子；`fs_append` offset 前置校验（重复/乱序显式 `offset_mismatch`） | `node-agent.js:169-212` |
| 实测延迟 | 树延迟真凶=**每请求重跑 ensureAgent 哈希校验**（独立 SSH ~1s），已由缓存缓解 | `workspace-gateway.js:36-38` 注释 |
| 实机证据 | 断线 → 502 + transport 分类 + retryable；BatchMode 非交互 fail-fast | `acceptance/block-67/p4-live.json` |

**核心结论**：断线恢复的两块基石（**真相落文件** + **偏移续读**）已具备；缺的是**跨操作连接复用**、**保活**、**自动恢复编排**——即「基石已备，编排未做」。

## 1. 六工作面（2026-09-16 缺口核对，按收益/成本排序）

每面独立可验收、独立提交；优先级与裁剪在 P0 评审由用户裁决。

- **W1 跨操作连接复用（最高杠杆，P1 阶段）**：现状 `runSshOp` 每次 `spawn('ssh', ...)` 新建 TCP + 密钥交换 + 认证（~1s），`__mux` 只解决**单次操作内**复用。→ 引入 `-o ControlMaster=auto -o ControlPath=<sock> -o ControlPersist=<T>`，后续连接复用同一通道，握手降至毫秒级；这是 D2 体感预算（树展开 P50≤1.5s）最直接的达成杠杆。
  **必须处理的实际坑（P0 评审定参）**：① ControlPath 路径长度上限（Unix socket ~104 字节，跨平台取短路径）；② 控制套接字残留（客户端被杀/异常退出）需清理逻辑与自愈；③ `MaxSessions` 默认 10 并发 channel 上限需与工作区并发量对账；④ Electron 退出 / 切换目标 / 目标删除时主动收敛；⑤ **Windows OpenSSH 不支持 ControlMaster**（机制基于 Unix domain socket）——按 D6「指挥席 macOS 优先」裁决，Windows 侧诚实降级并在 UI/文档明示，不伪装成功。
- **W2 长连接保活（P1 阶段）**：现状**无**任何 `ServerAlive*` 参数。→ 长流（作业日志观察、终端流）期间，云安全组 / NAT / 负载均衡可能静默回收空闲连接，客户端只能等操作超时才知晓。加 `-o ServerAliveInterval=15 -o ServerAliveCountMax=3`（45s 内探知死链）；参数值经 P0 评审按实测对账确认（对短操作影响小，对长流是刚需）。
- **W3 断线后自动重连 + 自动对账编排（P2 阶段）**：基石已有（状态文件 + 偏移续读），缺编排。→ 连接恢复后自动 reconcile 运行中作业 + 刷新工作区树 + UI 提示「已重新连接」；设计模式对齐 BLOCK-39 游标续传先例（同一套「断线重建 + 从游标续」思路，介质从本地 SSE 换成 SSH）。**不得引入第二真相**：对账只读远端 state.json/exit.json 与既有 Artifact 真相。
- **W4 重试策略增强（P2 阶段，小步）**：现有线性递增 + retryable 门控之上补 **抖动（±30% 防多目标同步风暴）** 与 **上限封顶**（如 8s）。约束：不得破坏既有幂等保证（`fs_write` 原子写、`fs_append` offset 校验是重试安全的前提，须有回归断言）。
- **W5 目标级健康探测与熔断（P3 阶段）**：现状连续失败仍每次干等 `ConnectTimeout=10`。→ 目标级连续 N 次 transport 失败后短暂标记该目标不可用（如 30s），期间快速失败并给用户可读原因；恢复探测后自动解除。值与窗口在 P0 评审定。
- **W6 连接状态可见性 + 高级连接参数（P3 阶段）**：状态徽标（在线 / 重连中 / 离线）+ 离线时**明示「当前显示非最新状态」**（D5 断线诚实呈现向 UI 层的延续）；高级参数（`ProxyJump` 跳板机、非标准端口/算法）评估——现状靠 ssh config 别名绕开（如 `aliyun-6022`），跳板机场景需显式支持。

## 2. 非范围（exclusions，写死）

- **不改 node-agent verbs 协议语义**：本包只增不改（可新增 verb 用于连接态/健康，不得改变既有 verb 的输入输出契约）；
- **不重开 BLOCK-57 D1–D9 / BLOCK-67 D1–D8 已交付裁决**（daemonless / thin per-call / 远程唯一真值 / key-only + known_hosts strict / argv 数组 + verb 白名单 / 断线诚实）；
- **BLOCK-92/93/94/95 文件面零触碰**：不拆 `SimpleChat.tsx`、不动 agentCategories 与子智能体 UI、不动知识空间召回挂点、不动会话信息流协议；
- **不做 VS Code 式「远端大脑」架构**（把语言服务/扩展宿主搬到远端）——本包只优化现有 thin-agent 通道；该架构判断已核对为不适用于本产品形态（人类级 <16ms 交互非本产品需求）；
- **不做 worktree**（`G0-RS-WT0` deferred，判据见 `docs/g0-result-studio-plan.md` §14）；
- **0 新依赖预期**：ControlMaster / ServerAlive* 均为系统 ssh 客户端参数，非 npm 依赖；若评估引入新依赖须走 `DEPENDENCY-CHANGE-CHECKLIST` + 用户裁决；
- **不改远端 agent 的「零安装、纯 bash 脚本」性质**（glibc/发行版兼容性是其核心价值，任何新增依赖都不得破坏该性质）；
- 手机投影侧连接面（BLOCK-70 隧道/会话）不在本包；
- Provider 矩阵 / packaged 公证 / GA 属 G1+；**G0 开发期常态 · 不外推 packaged/Provider/GA**。

## 3. 原则（本包家法）

1. **度量先行（红线）**：任何「更快 / 更稳」的宣称必须有**同场景前后对账数字**（连接握手耗时、树展开 P50/P95、重连恢复耗时），无数字不宣称；基线在 P0 用现有 `workspace-gateway` 注释所述 ~1s 量级作为起点，实测校准；
2. **断线诚实（红线，继承 D5）**：绝不本地暂存补写、绝不把「未确认」呈现为「已同步」；离线时 UI 必须明示状态来源与新鲜度；
3. **幂等与安全边界不动**：argv 数组（无本地 shell 拼接）、verb 参数白名单、`BatchMode=yes`、`known_hosts` strict 一律保持；重试增强不得削弱既有幂等断言；
4. **单一真相**：不新建第二套作业/连接状态真相；连接态是**派生态**，可从传输结果与远端文件重建；
5. **诚实降级**：平台/环境不支持的能力（如 Windows 的 ControlMaster）显式降级并在 UI 与文档写明，不静默假装可用。

## 4. 阶段划分（P0 评审可裁剪）

- **P0 设计评审**：延迟基线量化（握手 / 树展开 / 作业状态查询分项计时）+ W1–W6 参数与取舍 + Windows 降级形态 + 五项待裁决项（见 §6），产出评审结论待用户确认；
- **P1**：W1 连接复用 + W2 保活（传输层参数面 + 清理/收敛 + 降级分支）；
- **P2**：W3 恢复编排 + W4 重试增强（含幂等回归）；
- **P3**：W5 熔断 + W6 可见性与高级参数 + 实机收口（真远端前后对账）。

**环境纪律（launch checklist §1）**：dev 栈 = `npm run dev`（wrapper 起 vite `:3000` + biof3-server `:3001` + Electron，macOS 经 LaunchServices 启动）；**本包主模块在 `core/biof3-server/helpers/remote-execution/`，属后端代码——任何改动必须重启 dev 栈才生效**（Vite HMR 只覆盖前端）；实机验证需真远端（aliyun / dell）；CDP 实机走查用 `BIOF3_DEV_ELECTRON_ARGS="--remote-debugging-port=9222"`；并行包文件面零触碰声明见 §2 与 §6。

## 5. 验收门禁（收口时逐项对账）

- **定向单测**：`ssh-transport` / `remote-job-runner` / `error-classifier` 族（含新增 W1/W2 参数构造、W4 退避曲线、W5 熔断状态机）；
- **契约不变量**：既有 verb 协议零变更（transcript 级断言）、幂等（`fs_write`/`fs_append`）回归绿、argv 白名单负例仍 fail-closed；
- **实机（真远端 aliyun/dell）**：连接复用生效前后**握手耗时对账** + 树展开 P50/P95 对账 + 长流保活探知断言 + 断线恢复编排（拔网/杀连接）断言；
- **UI 面**（若 W6 落地）：连接状态徽标三态 + 离线明示断言；
- **治理门禁**：`npm run docs:check` + `npm run ui:audit:check` 必跑；
- 证据落 `acceptance/block-96/`；性能数字与断言数收口时按实记录，不预设。

## 6. 风险与待裁决项（P0 评审确认）

| # | 待裁决/风险 | 说明 |
| --- | --- | --- |
| D1 | ControlPersist 时长与收敛时机 | 兼顾复用收益与「目标已删除/凭据变更」的陈旧通道风险 |
| D2 | ControlPath 生成与清理策略 | 短路径 + 残留自愈 + 多目标命名；与 Electron 退出的联动 |
| D3 | Windows 降级形态 | 无 ControlMaster 时是否仍做保活、是否 UI 明示「此平台无连接复用」 |
| D4 | 保活参数值 | 15s/3 次是否与既有 30s 操作超时、作业长流节奏冲突 |
| D5 | 熔断阈值与恢复探测 | 失败 N 次 / 冷却 T 的取值；避免误伤瞬态抖动 |
| 风险 | 复用通道掩盖真实断线 | 控制连接假活时症状可能更隐蔽 → 以 W2 保活 + W6 可见性对冲 |
| 风险 | 与并行包撞期 | 本包主模块为 `core/.../remote-execution/`，与 BLOCK-92 Wave C（core 拆分）文件面可能重叠 → 撞期即停手上报裁决 |

## 7. 排队现状

当前**无 active 工作包**；候选队列=BLOCK-93 / BLOCK-92 / BLOCK-94 / BLOCK-95 / 本包 / BLOCK-85 Mac 双真机 / BLOCK-88 / P5（启动均需用户裁决）。本包主题（远端连接性能）与上述队列均不重叠，可独立启动。

G0 开发期常态 · 不外推 packaged/Provider/GA。
