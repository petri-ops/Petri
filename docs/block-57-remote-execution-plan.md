# BLOCK-57 — 远程执行：本地指挥席 + SSH 执行节点 + 调度器适配

> 状态：`active`（2026-09-04 用户裁决「启动 BLOCK-57 远程执行」；当前阶段 = P0 设计评审中，评审文档 [`block-57-design-review.md`](./block-57-design-review.md) 待用户确认后进 P1）
> 立项日期：2026-09-03（用户裁决「立项」）· 启动日期：2026-09-04（用户裁决「启动 BLOCK-57 远程执行」）
> truthDomain: `block-57-remote-execution`
> 来源：生信算力需求讨论（用户提出「适配算力集群进行大数据量运算」，问 Linux 版还是接口）

## 1. 背景与核心裁决

生信智能体特有关键需求：**算力**。大数据量运算（scRNA-seq 大矩阵等）超出本地笔记本能力，需要适配算力集群。

**核心裁决：不做 Linux 桌面版，做「本地指挥席 + SSH headless 执行节点」**：
- Linux 桌面版解决的是「操作系统认同」，不是算力——移植后仍跑在笔记本上，大矩阵该爆还爆
- 真选项是 **Headless Linux 执行节点**：把「执行层」拆出部署到集群，桌面留在本地当指挥席

## 2. 架构复用洞察（三项既有资产）

| 既有资产 | 远程执行中的角色 |
|---|---|
| **LanguageExecutor 抽象**（`core/shared-backend/executors/`，r/py 同接口：buildSpawnCommand/checkRuntimeVersion...） | 新增 `remote-executor.js` 即为天然扩展点，**不改核心** |
| **tool_jobs 状态机**（pending→running→done + 心跳 30s + 僵尸恢复 10min + 硬超时 30min，process-lifecycle.js） | 本就是异步作业管理器——远程作业直接复用，状态映射调度器 |
| **Job 文件级形态**（script.R + params.json + workDir） | 执行单元天然可打包（tar 提交 sbatch 成立） |

**结论**：远程执行不是重构，是「既有作业机器后面换一个执行者」。

## 3. 架构设计

```
┌─ 桌面（指挥席，本地）──────────────┐      ┌─ 执行节点（headless）────────────┐
│ UI / Agent loop / Spec 计划        │ SSH  │ biof3-agent（轻量守护进程）        │
│ Artifact 浏览 / 审阅 / 小数据预览   │◄────►│  ├ 作业接收：script+params 包     │
│ tool_jobs 状态机（心跳轮询）       │ 隧道 │  ├ 调度适配：sbatch/qsub/直跑      │
└────────────────────────────────┘      │  ├ 日志流回传（复用 SSE 链）        │
        artifacts 拉回（rsync+hash 校验）◄┤  └ 产物暂存 + 清单签名              │
                                          └──────────────────────────────────┘
```

### 3.1 四个关键设计裁决

1. **SSH 为唯一传输层**：不做 BioF3 云中转。认证 = 用户自己的集群凭据（SSH key），零新增攻击面，隐私叙事与本地优先一致（数据不出用户控制的机器链）。协议 = SSH stdio 上的 JSON-RPC（MCP 同款思路）。
2. **算力找数据（compute-to-data）**：脚本+参数 KB 级飞行，GB 级数据留原地。输入参数支持 remote-path 语义。
3. **调度器适配层**：Slurm（sbatch/sacct/scancel）/ LSF / SGE / 裸服务器直跑。状态映射：pending→submitted、running→排队+运行（scheduler 两态合并）、终态对齐。
4. **本地永远是默认**：BLOCK-30 摘除双模式的教训——不重新引入模式分叉。远程 = 每作业可选的 ExecutionTarget（执行目标），非部署模式。不开远程配置时一行行为不变。

## 4. 渐进路线（四阶段）

| 阶段 | 内容 | 价值兑现点 |
|---|---|---|
| **P1 SSH 直连** | 单服务器直跑（无调度器）：ssh spawn + 日志流 + 产物 rsync 拉回 + remote-executor 落地 | 「把实验室闲置服务器用起来」——最小真实价值 |
| **P2 Slurm 适配** | sbatch 提交/sacct 轮询/scancel 取消 + 排队位置显示 | 大学集群/HPC——生信算力主战场 |
| **P3 复现链跨机** | provenance 记录执行目标（host/OS/R 版本/调度 job id/环境摘要）+ 产物 hash 校验拉回 | 护城河强化（见 §5） |
| **P4 弹性扩展** | LSF/SGE 适配器、多目标路由 | 广度 |

## 5. 想象力清单（产品化表达）

- **`~/.ssh/config` 即目标清单**：零注册发现远程主机——「你的 SSH 配置就是你的集群列表」（codex「目录即项目」的算力版）。连上自动探测（OS/R 版本/调度器类型/核心数/内存）生成执行目标卡。
- **Agent 自选算力**：模型可见 `execution_targets` 只读工具——见 2GB count 矩阵自己说「该提交集群」，本地小活留本地。真正的 agentic 算力路由；与 BLOCK-49 spawn 衔接（未来子 agent 派驻远程跑）。
- **资源预估预填**：插件 descriptor 加 `resourceHints`（内存/时长建议，复用 parameterImpacts 模式），agent 提交 sbatch 自动填 `--mem=64G --time=4:00:00`。
- **排队即状态**：作业卡显示「集群队列第 3 位，预计 40 分钟」。
- **数据重力路由**：输入路径指向集群挂载文件系统时自动建议该集群为目标（数据在哪算力去哪）。

## 6. 复现性红利（被低估的核心价值）

远程执行让 Artifact Truth 从「本机可复现」升级为「**跨机可复现**」：provenance 记录「此分析跑在集群节点 gpu-07、R 4.5.2、Slurm job 12345、脚本+参数+环境摘要」——同一分析笔记本能重放、集群也能重放、结果逐字节对账。这是 Galaxy 都难轻量说出的能力，且与生信旗舰战略（product-strategy-review §3.3「科学可信」卖点）直接对齐。

## 7. 治理边界

- P1-P2 是产品能力（用户自己的服务器/集群，SSH 出去），不踩 G1+ 的 Provider/发布纪律
- **体量为排队清单最大包**（新传输协议 + 调度适配 + 产物同步）：建议排在 BLOCK-55 之后，启动前 P0 先做设计评审（错误处理/断线重连/凭据边界/产物完整性这些深水区在 plan 想透）
- 0 新 npm 依赖倾向（ssh2/rsync 走系统命令或既有依赖能力，实施时定）

## 8. 阶段

- **P0 立项 + 设计评审**：本计划登记；启动时先产出设计评审文档（传输协议细节/断线语义/凭据处理/产物校验/错误分类）经用户确认再进 P1。
- **P1 SSH 直连**：remote-executor + biof3-agent 守护进程 MVP + 日志流 + rsync 拉回。
- **P2 Slurm 适配**：调度适配层 + 排队状态映射。
- **P3 复现链跨机**：provenance 扩展 + hash 校验。
- **P4 广度**：LSF/SGE/多目标路由。

## 9. 验收门（P0 设计评审时细化）

- P1：真实闲置服务器上跑通全链路（提交→日志流→产物拉回→job 终态对齐）；本地作业零回归（不开配置行为不变）。
- P2：真实 Slurm 集群（或测试环境）sbatch 提交/取消/排队显示全对。
- P3：跨机复现对账（同分析本地/远程产物 hash 一致性声明；环境差异如实记录不掩盖）。
- 治理：`docs:check` + `docs:reconcile` 收口必跑。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 10. 风险与对策

| 风险 | 对策 |
|------|------|
| SSH 断线中作业状态丢失 | 作业状态以节点侧为准（重连后 reconcile）；心跳语义复用既有 zombie 恢复 |
| 产物大文件同步慢 | 清单先行（manifest+hash）+ 按需拉回（UI 浏览元数据，打开才拉） |
| 调度器版本差异（Slurm 变体） | 适配层版本探测 + 输出解析容错（sacct 格式差异）；P0 设计评审列已知变体 |
| 双模式回潮（BLOCK-30 教训） | ExecutionTarget 为作业级参数非全局模式；不开配置 = 本地执行器路径，代码上同一入口 |
| 凭据安全 | 只用 SSH key（用户既有凭据），BioF3 不存密码；known_hosts 校验开启 |

## 11. 进度记录

- 2026-09-04 P0（启动 + 设计评审产出）：用户裁决「启动 BLOCK-57 远程执行」，本工作包转 active（当前唯一）。设计评审文档落盘 [`block-57-design-review.md`](./block-57-design-review.md)：基于源码事实基线（executors 注册表接口 / tools-executor executeJob 全流程 / process-lifecycle 心跳-僵尸-硬超时 / artifact-manifest 形状）给出九项设计裁决 D1-D9 + 五项与原 plan 的偏差清单（daemonless 节点侧 / tar-over-ssh 基线 / remote-execution 目标级模块落位 / 远程作业豁免本地 zombie stale-fail 与 30min 硬超时 / 主机指纹 strict 默认）+ 错误分类表 + P1 范围切分 + 验证策略（unit / loopback live / 真实节点收口门）+ 待用户确认问题清单八项。**P1 待评审确认后启动**。
- 2026-09-03 P0（planned 登记）：用户裁决立项；方案=本地指挥席 + SSH headless 执行节点 + 调度器适配（不做 Linux 桌面版）；三项既有资产复用（executor 抽象/tool_jobs 状态机/Job 文件级形态）；四阶段渐进 + 想象力清单 + 跨机复现红利；本计划落盘并注册 DOC-REGISTRY；建议排在 BLOCK-55 之后，启动前 P0 设计评审。
