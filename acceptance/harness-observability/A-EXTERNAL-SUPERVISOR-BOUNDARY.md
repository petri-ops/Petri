# U 类裁决材料 · A 形态外部监督器「权限边界与升级策略」（2026-11-25 · pending_user_ruling）

> 来源：兴奋 2026-11-25 harness 评估第 9 项 → BLOCK-520 P2 单列 → 主人裁 C 先行（只观测）。
> 本件承接 C 形态落地后的明确授权「彻底解决」，把 U 材料从 C 往前推到 A 的**立项前材料**。
> **本件不含任何守护进程/自动重启代码**；按 U 材料红线「若裁 A/B，必须先出权限边界材料」，此处即该材料。未获最终口令前不写控制面代码。

## 0. 现状核码（2026-11-25 实读，非照抄审计稿）

| 原语 | 真实状态 | 能力边界 |
|---|---|---|
| `loop-orchestrator.js`（1658 行） | 进程内状态机：checkpoint / stall-resume / 退避重试 / 成本熔断 / finalization retry | 进程内；进程死即终结 |
| `server-main.js` 启动恢复 | 把卡住的 loopRun/tool_jobs 标 `failed(recovery_required=true)` | **DB 级标记，不重启、不接管** |
| `stale-running-reconciler.js` | 60s 扫 `status='running'` 且无 owner → 标 failed | **只标死，不重启**；判定主据=进程内 `activeToolJobs` |
| `tool-job-lifecycle-registry.js` | 进程级 `activeToolJobs` Map + 心跳 + 僵尸扫描 | 进程内，跨进程不可见 |
| `automation-runner.js` | 10s 定时，向本机 `POST /api/ai/agent` 提任务 | 进程内定时；是 B 形态雏形 |
| `external-supervisor.js`（C 形态，已落） | `createExternalSupervisor()` 观测汇：incidents + metrics + error-log + health + fingerprint；两个 reasonCode（heartbeat_timeout / abnormal_exit）；**只观测不动作** | **没有常驻进程、没有定时巡检、没有信号发送、没有 DB 改写**；检测靠既有设施回调 |
| `metrics.js` | 已有 `recordSupervisorObservation({reasonCode})` + `/api/_internal/metrics` | 计数已埋点，可承 A 形态观测 |
| `health.js` | `buildHealthShape` + `/api/health` 挂 `supervisorSnapshot` | 观测面就绪 |

**结论**：C 形态已把「不可见 → 可见」做完；A 形态要补的是**唯一缺失的一层——带动作的控制面**（心跳判定 + 重启/升级）。

## 1. 目标与红线

**目标**：让「卡死 / 进程异常退出」从「可见但无人接管」变成「按既定策略自动重启或升级给人」，同时**绝不误伤 owner 的开发实例**。

**绝对红线**（继承 U 材料，不可破）：
1. 未获主人最终口令「做 A」，不写任何守护进程 / 自动重启 / 进程信号代码。
2. 不改 loop 三档契约、不改 DB `recovery_required` 语义。
3. owner 实例 / 9223 调试实例 / 主人 dev 栈**永不进入自动重启候选集**——豁免优先级高于一切超时判定。
4. 借鉴 C-32/C-43 教训：先核码复核真源，HK-01 红绿先行，提交留本地、push 待口令。
5. 豁免清单与 fail-safe 是唯一准入条件；判定阈值可在 L2 上线后灰度调参，不设观察期前置。（第一性原理修正：影子模式防不了误杀，豁免清单才能；观察数据用于调参，不用于决定做不做。）

## 2. 进程身份与豁免清单（最关键）

A 形态的第一风险是「误杀」。必须先建立**可判定的进程身份**：

| 识别维度 | 来源 | 用途 |
|---|---|---|
| 实例 role 标签 | 启动时写 `instance_role`（`prod_user` / `dev_owner` / `test_9223`）到 dataDir 本地状态 + `/api/health` 暴露 | 自动重启**只对 `prod_user` 生效** |
| 监听端口 | `getBackendPort('r')` 实值（默认 3001；owner dev 常占 3001/3003、CDP 9222/9223） | 端口属 owner/dev 段即豁免 |
| 父进程链 | Electron main → backend 的 spawn 关系 | 能确认为 owner 手动起的实例即豁免 |
| dataDir 路径 | `resolveDataDir()`：owner dev 用 `.petri-dev-user-data`，测试用 `.petri-test-user-data` | 路径命中 dev/test 即豁免 |

**豁免判定顺序**（任一命中即跳过，短路）：
1. `instance_role != prod_user` → 豁免
2. dataDir 含 `dev-user-data` / `test-user-data` → 豁免
3. 端口在 owner/dev 保留段 → 豁免
4. 无明确 `prod_user` 身份标签（身份不明）→ **保守豁免**（fail-safe：宁可不重启，不可误杀）

只有**显式标记 `prod_user` 且四项全过**的实例，才进入动作候选集。

## 3. 心跳与超时判定（复用现成设施，不造第二套）

| 信号 | 现成检测设施 | 交给监督器的判据 |
|---|---|---|
| 会话心跳超时 | `stale-running-reconciler` 60s 扫描（已有） | 工具 job 无 owner 且心跳超时 → 只读回调通知监督器，**由监督器再判定是否升级**（不重复判定） |
| 进程异常退出 | `installProcessErrorHandlers`（C 形态已装 uncaughtException/unhandledRejection） | 捕获即通知，带 `opaqueKey(sessionKey)` |
| 后端重启次数 | `metrics.backend.restarts`（已有） | 单位时间重启超阈值 → 判「重启风暴」，**暂停自动重启转人工** |

**不做**：独立常驻守护进程轮询所有进程（A 材料的原始形态，权限面最大）。改为 **C 形态观测汇 + 既有检测设施回调**：监督器本身仍不定时巡检，只在被通知时按策略动作。这样把「新常驻进程/端口」的攻击面降到最低，同时保留 A 的「动作」能力。

> 若主人坚持要真正的独立守护进程（跨进程存活、能救 Electron 主进程整体崩溃），那是 A 的完整形态，需要单独的进程部署/权限材料——本件先按「回调触发的动作层」设计，风险可控且覆盖绝大多数「会话卡死」场景。

## 4. 升级策略（分级动作，全程留痕）

| 级别 | 触发 | 动作 | 可逆性 |
|---|---|---|---|
| L0 观测 | 任意心跳/退出信号 | 写 incidents + metrics + error-log + health（**C 形态已有**） | 无副作用 |
| L1 告警 | 同一 fingerprint 在窗口内 ≥ N 次 | 主人可见渠道通知（仅本地/已连接渠道），**不动作** | 无副作用 |
| L2 自动重启 | 仅 `prod_user` 实例 + 单次超时 + 非重启风暴 | 按既有 `POST :id/resume` 链恢复会话（**复用现成恢复链，不自造**） | 可逆（恢复失败即标 `recovery_required`） |
| L3 人工升级 | 重启风暴 / 身份不明 / 豁免实例异常 | 只告警 + 写材料，转主人裁决 | 无副作用 |

**L2 的边界**：只做「会话级续跑」（`resume` 端点已存在），**不做进程级 kill/restart**。进程级重启留作 L3 人工——这是把不可逆操作挡在自动链路之外的关键闸门。

**审计留痕**：每次 L1/L2/L3 都写 incident（脱敏 fingerprint）+ DEV-DECISION 式决策记录（reasonCode + 判据 + 动作 + instance_role），`/api/health` 的 `supervisorSnapshot` 可见。

## 5. 第一性原理修正：取消影子前置，直达 L2（HK-01 红绿先行）

**为什么可以直达**：主人指出「无论影子还是维持 C，终点都是同一条最终路径」。确实——影子模式的价值只是"积累调参数据"，但它**不是动作的前置条件**。C 形态（`external-supervisor.js`）已经在跑观测汇，事故频次/形态的数据**现在就在积累**（incidents + metrics.byReason）。L2 动作本身复用现成 `resume` 端点、失败即回落 `recovery_required`，是**可逆**的；真正不可逆的 L3 已永久挂账。所以无需先空跑一个零动作的影子阶段。

**直达前提（唯一硬门槛）**：§2 的进程身份 + 豁免清单 + fail-safe 必须先落地并红测通过——这才是"不误杀"的真正保障，与是否影子无关。

**HK-01 红绿先行**：
1. 红测：owner/9223/dev/身份不明实例全部命中豁免（零误杀）；prod_user 进候选；重启风暴触发熔断；resume 失败回落 `recovery_required`。
2. 实现转绿，再接 L1 告警 + L2 续跑动作。
3. 测试注入 deps（mock processEmitter / reconciler 回调）可控时钟验证；不碰 owner 实例。
4. **上线后**用 C 形态已积累的 metrics/incidents 校准"卡死"阈值——调参在动作开启之后，而非之前。

## 6. 分阶段落地与工作量

| 阶段 | 内容 | 依赖 | 风险 |
|---|---|---|---|
| A-会话级（直达） | 进程身份标签 + 豁免清单 + L1 告警 + L2 超时→resume 续跑 + 重启风暴熔断 | 复用 C 形态观测汇 + 既有 resume 链；无需观察期前置 | 中（自动动作但可逆） |
| A-进程级（挂账） | L3：进程 kill/restart | 独立裁决 + 进程部署材料 | 高（不可逆，默认不开） |

**推荐**：直达 A-会话级（唯一门槛=豁免清单红测），A-进程级默认永久挂账；阈值上线后用已有数据校准。

## 7. 裁决口令

- 「**做 A-会话级**」= 立项直达工作包（豁免清单 + L1 告警 + L2 会话级续跑），无需影子前置。
- 「**做 A-进程级**」= 独立进程部署/权限材料先行，默认不建议。
- 「**维持 C**」= 保持只观测，不开动作（体感不稳根因保留）。

status: pending_user_ruling（等主人拍板；Agent 不代答、不写控制面代码、不开工）
