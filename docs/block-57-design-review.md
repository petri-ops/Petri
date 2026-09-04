# BLOCK-57 P0 设计评审 — 远程执行深水区

> 状态：`confirmed`（2026-09-04 用户裁决「可以的 你来」全项确认；真实节点验收服务器指定为 `aliyun`——实测 Ubuntu kernel 6.8 / Python 3.12.3 / GNU tar 1.35 / 2C1.6G / key 认证 BatchMode 直通，节点无 R：R 作业诚实走 runtime_missing 路径，P1 全链路验收以 Python 工具作业承载）
> 归属：`BLOCK-57-REMOTE-EXECUTION`（canonical plan：[`block-57-remote-execution-plan.md`](./block-57-remote-execution-plan.md)）
> 评审范围：plan §8 P0 指定深水区 —— 传输协议细节 / 断线语义 / 凭据处理 / 产物校验 / 错误分类
> 评审日期：2026-09-04

---

## 1. 代码事实基线（评审输入，均已读源核实）

| 事实 | 出处 |
|---|---|
| 执行器注册表接口为**语言级**：`name / binPath / buildRunArgs / buildPoolWorker / checkPackageInstalled / installPackages / checkRuntimeVersion / checkBuiltAgainst`；加语言 = 新实现 + `registerExecutor()` | `core/shared-backend/executors/index.js` |
| R 工具脚本的 spawn 约定是 `[Rscript, run-script.R, jobDir]`（job_dir 单参数约定，**不是** buildSpawnCommand 的 `--args params.json` figcode 约定）；Python 非插件走 buildSpawnCommand | `core/biof3-server/helpers/tools-executor.js:1375-1416` |
| `executeJob` 全流程：claim owner → pending→running → 快照 staged inputs → 建 `jobDir/output` → 拷脚本/模板/`_biof3-theme.R` → runtime 检查（`executor.binPath` + `getRuntimeVersion`）→ BLOCK-58 依赖检查（非插件 R）→ `execFile`（timeout 0 / maxBuffer 10MB）→ 回调收尾 → provenance.json 落 jobDir → artifact 校验（fail → `markJobFailed(stage='artifact_validation')`）→ result_json | `tools-executor.js:1246-1500` |
| tool_jobs 状态机：pending→running→done/failed/cancelled；心跳 30s（写前先 `kill(pid,0)` 探活）、僵尸 10min、硬超时 30min、TERM→KILL 升级且「SIGKILL 被接受 ≠ 终态」；`markUnownedStaleJobs` 对无句柄心跳失活任务**只标 failed 不发信号**（PID 归属不能证明时不杀） | `core/biof3-server/helpers/process-lifecycle.js` |
| 产物清单：`collectExecutionInputs`（file 输入 → sha256/size/relativePath）+ `writeArtifactManifest`（manifest.json：artifactManifestVersion/status/plugin/artifacts[].sha256/reproductionTarget），hash 函数 `hashFile` | `core/shared-backend/artifact-manifest.js` |
| durable cancellation：spawn 前有 `canLaunchOwnedToolJob` 闸（持久取消态可抑制启动） | `tools-executor.js:1420` |

**关键结论**：LanguageExecutor 是「语言运行时怎么跑」的抽象；远程执行是「在谁那里跑」的目标级关注点，**横跨 R/Py 两语言**。因此 remote 落位不是又一个 LanguageExecutor 实现（见 §3 偏差 D3）。

---

## 2. 设计裁决（P0 评审核心产出）

### D1 节点侧形态：无守护进程（daemonless）——修正 plan 原文「biof3-agent 守护进程」

plan §3 架构图画了常驻 `biof3-agent` 守护进程。评审建议 **P1 改为 daemonless**：

- 节点侧 = **一个自包含 bash 脚本 `biof3-agent.sh`**（verbs：`probe / start / status / log / cancel / version`）+ **每作业一个 detached runner 进程**（`setsid nohup` 拉起，SSH 断开不影响）。
- 作业状态 = 节点侧文件 `jobs/<jobId>/state.json`（原子写：tmp+rename）+ 终态 `exit.json`。**节点文件即作业真相**，无 daemon 即无 daemon 生命周期/版本漂移/自启（systemd）三类故障面。
- 脚本按需上传 + sha256 版本钉扎（本地记录已部署 hash，不一致即重传），节点**无需安装 Node.js**（集群上用户常无权装）。
- 守护进程（常驻连接、推送式日志）登记为 P4 可选优化，不做 P1 前置。

**备选对比**：daemon 优势仅是省每次连接握手（<1s，key auth）与推送日志；代价是安装面、自启面、版本面三重运维。P1 取 daemonless。

### D2 传输协议：system `ssh` + tar-over-ssh 基线；rsync 降为可选加速

- **只用系统 `ssh`**（child_process spawn，**argv 数组**，本地侧零 shell 字符串拼接），0 新 npm 依赖坐实（不用 ssh2 库）。统一参数：`-o BatchMode=yes -o ConnectTimeout=10`。
- **文件传输基线 = tar-over-ssh 流**：上传 `tar -C jobDir -cf - run-script.R params.json inputs/ | ssh <alias> 'tar -xf - -C ~/.biof3-agent/jobs/<id>/'`；拉回反向。两端只要 ssh+tar（POSIX 集群必有；Windows 指挥席 bsdtar 内置）。
- **rsync 不是基线而是可选优化**：检测两端 rsync 可用且大文件拉回时启用（断点续传红利）。修正 plan §4 P1「rsync 拉回」字样——Windows 指挥席无 rsync，tar 基线才可移植。
- P1 不做 ControlMaster 连接复用（登记 P4）：ops 命令（submit/status/cancel）短连接成本低；日志是每作业一条长连接（`ssh <alias> biof3-agent.sh log <id> <offset>` 流式 tail）。
- 远程命令面收敛：节点侧一切操作只经 `biof3-agent.sh` 固定 verbs；jobId 强校验 `^[A-Za-z0-9._-]{1,64}$`；params 内容永不进入命令行。

### D3 代码落位：`helpers/remote-execution/` 模块（修正 plan「executors/remote-executor.js」表述）

- 新模块 `core/biof3-server/helpers/remote-execution/`：`target-registry.js`（目标注册+~/.ssh/config 只读发现）/ `ssh-transport.js`（argv 构建+连接+流）/ `node-agent.js`（脚本文本+版本+部署）/ `remote-job-runner.js`（submit/log/cancel/reconcile 编排）/ `error-classifier.js`。
- `executors/` 目录**不动**（r/py 执行器零改动）；语言知识以「探针提示」形式被远程层消费：节点侧二进制名与版本命令（`Rscript --version`）从既有 executor 约定推导，节点运行时探测由 agent 脚本 `probe` 完成。
- 理由见 §1 关键结论：远程是目标级横切关注点，塞进语言级接口会扭曲接口语义（`buildPoolWorker`/`installPackages` 对远程无意义）。
- `tools-executor.executeJob` 入口处单一分派：`job.execution_target_id` 为空 → 走**原路径逐字节不变**；非空 → `remote-job-runner`，**复用**同一 jobDir 布局、provenance 构建、`markJobFailed` stage 语义、artifact 校验、result_json 形状、SSE 进度事件。

### D4 状态机映射与节点真相

| 本地 tool_jobs | 触发 | 节点侧真相 |
|---|---|---|
| pending | bundle 上传完成且 `agent start` 确认 | state.json 出现（status=submitted） |
| running（detail=排队/运行，P2 用） | state.json status ∈ {submitted, running} | 调度器两态按 plan 合并 |
| done | exit.json code=0 **且** 本地 artifact 校验通过 | exit.json |
| failed(script_fail) | exit.json code≠0（stderr 尾部回传） | exit.json |
| failed(runtime) | probe 无对应运行时 | probe 结果 |
| failed(artifact_validation) | 拉回 hash 对账失败（fail-closed） | transfer-manifest 对比 |
| cancelled | cancel 确认（节点 kill 或 scancel 后 status 对账） | state/exit.json |

- **节点真相胜出**：任何 reconcile 冲突（本地说 running、节点说 done）以节点为准回写本地。
- 心跳：本地 30s 轮询 `status`（healthy 时）刷新 `tool_jobs.heartbeat_at`，语义仍是「本地对远端的最近一次确认知晓」。

### D5 断线 / 重连 / 本地恢复语义（本包最深的坑）

1. **SSH 通道 ≠ 作业**：日志 tail 通道断开只是「观察断开」，作业在节点继续跑（detached runner）。本地不因通道断开改写作业状态，UI 如实显示「连接中断，作业状态未知（以节点为准）」并进入退避重连。
2. **reconcile 触发点**（幂等，全部走同一入口）：日志通道断开 / status 连续失败越阈 / **本地后端重启启动扫描**（`tool_jobs` 中 running 且 `execution_target_id` 非空 → 逐个 reconcile）/ 用户打开作业详情。
3. **本地僵尸恢复豁免**（需改 `markUnownedStaleJobs` 守卫）：现有 sweep 会把「心跳失活且无句柄」的 running 作业标 failed——对远程作业是**错的**（连不上 ≠ 作业死）。守卫改为：`execution_target_id IS NULL` 才走本地 stale-fail；远程作业心跳失活 → 触发 reconcile 而非标败。
4. **硬超时豁免**：本地 30min 硬超时是本地子进程预算；远程作业不受它管（否则笔记本挂机 30min 误杀集群长任务）。远程时限 = 节点侧 runner 可选 `timeBudgetSeconds`（每目标配置，默认不限——交给集群策略），P2 由 sbatch `--time` 承接。
5. **日志续传**：`runner.log` 节点侧 append-only；本地记录字节偏移，重连 `log <id> <offset>` 续读，不重复不漏段；单文件 10MB 软顶（超限滚动，旧段保留不删）。
6. **取消的持久性**：cancel 请求先落本地 durable 取消态（复用 `canLaunchOwnedToolJob` 同源机制），连接不可达时挂起，重连后补发 `cancel`，以节点终态确认收敛为 `cancelled`。

### D6 凭据与安全边界

- **只认 SSH key**：BioF3 只存目标别名（alias）字符串；私钥/密码永读取、永不落库。`~/.ssh/config` 全量生效（IdentityFile/ProxyJump/Port/User）——「用户的凭据链就是 BioF3 的凭据链」。
- **发现即清单**：目标注册表默认从 `~/.ssh/config` 只读解析（仅 Host/HostName/User/Port 字段，自实现最小解析器，0 依赖）；加目标也可手动填 alias。
- **主机指纹默认 strict**：known_hosts 里没有的主机直接失败，错误信息指引「用户自己在终端 `ssh <alias>` 一次完成首次信任」。**不做 accept-new/TOFU 默认**（可在目标设置里显式 opt-in，P1 不做）。
- **BatchMode=yes**：任何交互式认证（密码/keyboard-interactive/2FA）快速失败并诚实报「该目标需要交互认证，暂不支持」。
- **出站边界**：仅在用户显式动作（添加/探测/提交作业）时发起 SSH；无后台扫描、无自动连接。
- **数据边界**：出站 payload = 脚本（KB）+ params.json + 显式声明的小文件输入；远程路径输入引用（GB 数据留节点）由 runner 起跑前 `probe`/存在性检查，缺失即 `node_missing_input` 快败。compute-to-data 落地。

### D7 产物完整性与拉回（manifest-first + 双层 hash + 按需）

- 节点 runner 收尾时对 `output/` 逐文件算 sha256 写 **`transfer-manifest.json`**（传输完整性专用）。
- 拉回协议：① 先拉 `transfer-manifest.json`（KB 级）→ ② 拉产物文件 → ③ **本地重算 sha256 对账**；不符重拉一次，仍不符 → `markJobFailed(stage='artifact_validation')`（复用既有 stage，fail-closed，诚实报损）。
- **Artifact Truth 单一形状不破坏**：对账通过后，本地照常由服务端构建 `provenance.json` + `writeArtifactManifest`（与本地作业同一条代码、同形状）——节点 jobDir 只是执行 scratch，本地 jobDir 仍是 canonical 证据目录。
- **按需拉回**：单作业自动拉回总额阈值（默认 200MB，目标可配）；超限产物先出元数据清单，UI 打开时按需拉取。防「一次分析拖回 10GB」。
- **provenance 跨机扩展（P1 先埋 additive 字段）**：`executionTarget: {kind:'ssh-direct', alias, hostname, os, agentVersion, runtime:{name,version(节点实测)}, remoteJobDir, command, transferManifestSha256, startedAt, completedAt}`。P3 在此块上加调度器 job id / 环境摘要，形状前向兼容。
- 时间戳纪律：节点事件用节点时钟并在 provenance 标注来源，避免跨机时钟偏移污染本地事件序。

### D8 错误分类（error-classifier 单一出口）

| 类 | 判定 | 作业影响 | 重试策略 |
|---|---|---|---|
| transport.network | ssh exit 255 + stderr 含 resolve/timeout/refused | **不标败**，detail「节点不可达，状态未知」 | 指数退避，上限后挂起待 reconcile |
| transport.auth | exit 255 + Permission denied / BatchMode 失败 | 不标败；目标标 needs-attention | 不重试，等用户修凭据 |
| agent.version_mismatch | probe version hash 不符 | 不标败 | 重传脚本后重放操作 |
| node.runtime_missing | probe/exit 报运行时缺失 | failed(stage=runtime) | 无（配置问题） |
| node.script_fail | exit.json code≠0 | failed(script_fail)，stderr 尾部回传 | 无（科学失败如实） |
| node.missing_input | runner 输入存在性检查失败 | failed(stage=setup) | 无 |
| transfer.hash_mismatch | 拉回对账失败（含重拉一次） | failed(artifact_validation) | 无（fail-closed） |
| reconcile.conflict | 本地/节点状态分歧 | 以节点为准回写 + 记录分歧 | — |
| cancel.unreachable | cancel 时节点不可达 | 保持 running + durable 取消态 | 重连补发 |
| **未识别 stderr** | 兜底 | **不标败**，归 transport.unknown 走退避 | 保守重试 + 明细透出 |

分类器是纯函数（stderr/exit code 文本 → 结构化类），unit 全覆盖；杜绝「网络抖动把 30 分钟作业标废」这一最伤用户的路径。

### D9 ExecutionTarget 语义与零回归不变量（BLOCK-30 教训的落地条款）

- 目标是**作业级可选参数**（`tool_jobs.execution_target_id` additive 列），不是全局模式、不是环境开关；不存在「远程模式」。
- **零回归不变量（验收断言，非口头承诺）**：`execution_targets` 表为空 ⇒ UI 不渲染任何远程相关 surface；`executeJob` 走原路径分支判断一次即返回；全部既有 tool job 测试不改一行通过。
- UI 最小面（P1）：设置页目标管理（列表/探测/添加/移除）+ 工具运行表单目标选择器（**仅当目标存在时渲染**）+ 作业卡目标徽章 + 不可达降级文案。Agent 可见 `execution_targets` 只读工具**不在 P1**（登记候选，与 BLOCK-49 衔接）。

---

## 3. 与原 plan 的偏差清单（需逐条确认）

| # | plan 原表述 | 评审修正 | 理由 |
|---|---|---|---|
| 1 | §3 架构图「biof3-agent（轻量守护进程）」 | daemonless：CLI 脚本 + detached runner + 文件真相（D1） | 去掉 daemon 三类故障面；集群免装 Node |
| 2 | §4 P1「产物 rsync 拉回」 | tar-over-ssh 基线 + rsync 可选加速（D2） | Windows 指挥席可移植性 |
| 3 | §2「新增 remote-executor.js 为 LanguageExecutor 扩展点」 | `helpers/remote-execution/` 目标级模块；`executors/` 不动（D3） | 远程跨语言，塞语言级接口扭曲语义 |
| 4 | §10「心跳语义复用既有 zombie 恢复」 | 复用心跳字段但**豁免** zombie stale-fail，改走 reconcile（D5.3） | 「连不上≠作业死」是远程语义反转点 |
| 5 | （plan 未提）本地 30min 硬超时对远程作业 | 豁免；时限节点侧自管（D5.4） | 防误杀集群长任务 |

## 4. P1 范围切分

**In**：目标注册表 + ssh-config 发现 + probe；bundle 上传（tar）；daemonless agent（bash，版本钉扎）；R/Py 直跑；日志流（偏移续传）；reconcile 全触发点（含重启扫描）；取消（TERM→KILL 确认收敛）；transfer-manifest 双层 hash 拉回 + 阈值按需；provenance executionTarget 块；UI 三处最小面；单测 + loopback live 门禁。

**Out（登记去向）**：Slurm 适配/排队显示（P2）；复现链跨机深化（P3）；LSF/SGE/多目标路由（P4）；`execution_targets` agent 工具 / 数据重力路由 / resourceHints 预填 / ControlMaster（候选）；figcode 交互脚本远程化（不在本包）；节点侧 R 包治理的远端等价物（候选，BLOCK-58 思路延伸）。

**平台边界**：指挥席 P1 支持 macOS/Linux（Windows 指挥席缺 rsync/ssh 可选特性，P1 不承诺，如实登记）；执行节点恒为 Linux。

## 5. 验证策略

1. **Unit（node --test，零网络）**：ssh-config 解析 fixture / argv 与 verbs 构建 / 状态映射转移表 / reconcile 决策表 / error-classifier 全类 / transfer-manifest 校验（tmp 文件）/ **零回归守卫断言**（无目标时分派返回本地 runner）。
2. **Loopback live（`scripts/block57-live.cjs`，localhost sshd 当假节点）**：A 全链提交→日志→拉回→done 且 hash 对账；B 运行中取消→cancelled；C 杀 SSH 通道作业继续→重连 reconcile→done；D 节点无 R→failed(runtime)；E 篡改产物→hash 对账→failed(artifact_validation)；F 空目标表零回归探针。本机 sshd 未启用时诚实 skip 并显式标注。
3. **回归**：既有 tools-executor / process-lifecycle node 测试 + 触及前端 vitest + tsc 0 + docs:check + ui:audit:check。
4. **真实节点**（plan §9 P1 收口门）：用户提供闲置 Linux 服务器全链路验证——此门不可用 loopback 替代。

## 6. 风险补充（在 plan §10 基础上新增）

| 风险 | 对策 |
|---|---|
| 登录节点跑重活违反集群礼节 | P1 明确定位「闲置服务器直跑」；HPC 礼节（排队/配额）= P2 sbatch 承接，文档如实写 |
| 节点 R 包环境不受 BioF3 管 | P1 诚实报 script_fail + stderr；节点侧包治理登记候选 |
| 2FA/交互认证目标 | BatchMode 快败 + 明确文案（D6） |
| 时钟偏移 | 节点事件用节点时钟并标来源（D7） |
| runner.log 无限增长 | 10MB 滚动软顶（D5.5） |
| 大产物拖垮指挥席 | 阈值 + 按需拉回（D7） |

## 7. 待用户确认问题清单（P1 启动闸门）

1. **D1** 节点侧 daemonless（CLI + detached runner）替代 plan 原文守护进程 —— 确认？
2. **D2** tar-over-ssh 为传输基线、rsync 降为可选加速 —— 确认？
3. **D3** 代码落位 `helpers/remote-execution/`（而非 `executors/remote-executor.js`）—— 确认？
4. **D5.3/5.4** 远程作业豁免本地 zombie stale-fail 与 30min 硬超时（节点侧真相 + 节点自管时限）—— 确认？
5. **D6** 主机指纹默认 strict（首次信任由用户手动 `ssh` 一次），TOFU 仅作后续显式 opt-in —— 确认？
6. **D7** 传输完整性走独立 transfer-manifest，Artifact Truth 形状与本地作业完全同构 —— 确认？
7. **D9** 零回归不变量作为 P1 验收断言（空目标表 = UI 无远程面 + 既有测试零改动）—— 确认？
8. P1 收口的真实服务器验收（plan §9）需要一台闲置 Linux 服务器 —— 何时提供？

> 以上任一条有异议即回到本评审修订；全部确认后本文档转 `confirmed`，BLOCK-57 进 P1。
