---
capability: tail-ledger-clearing
goal: BLOCK-211 = runlist W8 收尾族。**本包按"逐项独立验收"执行**，不追求一次全清。首批（P1）清偿 **C-32：decision-config 的 env='1' 语义与自身注释相反**——把 env='1' 从"运行时强制开"降级为**首载种子**（`env='0'` 仍是永不违逆的杀开关），使"设置页关掉的守卫不会被残留 env 重新打开"；连带修正 `envShadowedKeys` 对 seed 的误报（否则 doctor 会把不生效的 env 报成遮蔽）。
acceptance:
  - P0 基线：C-32 现状先钉住（`test/block199-config-compat.test.mjs` 里钉"env=1 强制开"的那条要在同一提交里**显式改写**并留因，不得静默改）。
  - P1 C-32 清偿：`decision-config.getPointRuntime` 生效顺序=`env='0'`（杀）> 文件 > `env='1'`（种子）> 注册表默认；`shared-config` 标注 `envOneIsSeed` 并让 `envShadowedKeys` 对 seed 不报"遮蔽生效值"。
  - P2 回归面：设置页读写、`/api/ai/agent/decisions` 端点、dev 脚本里靠 `env=1` 开接点的用法（`test:suggest`/`doc:suggest` 等）全部核过——seed 语义下"没有文件配置时 env=1 仍能开"，"有文件配置时以文件为准"。
  - 其余 W8 项（lint 基线净收缩 / 双机 riders+BK-08 / 休眠插件激活裁决 / RS 徽标语义 / C-27 拒绝类 judge 口径 / C-30·C-31 销号）**逐项另立小批**：需要裁决的（休眠插件）、需要第二台机器的（双机 riders）、需要成对实验的（C-27）不在本批强行收口。
  - 完成语义：本批只交付 C-32；W8 其余项保持"在册未清"，不得因为本包收口就宣称 W8 完成。
reopen: lint 基线净收缩；双机 riders 与 BK-08 销号（需第二台机器/实机）；休眠插件激活裁决（需用户裁决）；RS 徽标语义诚实化（UI + 台账）；C-27 成对实验；C-30/C-31 立项或销号。
status: completed
---

# BLOCK-211 · W8 收尾族（首批：C-32 env 语义清偿）

执行序位置=`docs/stage-3-4-execution-runlist.md` 的 **W8**（W0–W7e 已 completed）。用户发令：2026-10-18「好 棒 满意 继续后面的工作」。

## 0. 为什么先做 C-32

其余 W8 项各有前置：lint 收缩是机械降债、双机 riders 要第二台机器、休眠插件要**用户裁决**、C-27 要成对实验、C-30/C-31 是立项/销号判断。**C-32 是唯一"纯代码 + 有明确判据 + 影响治理透明度"的一项**：它现在的行为是"用户在设置页关掉守卫，只要环境残留 `PETRI_JEV_*=1` 它又开了"——这是"我关掉了但它还开着"，直接命中治理透明魂面。

## 1. 语义定义（本批的验收口径）

| 层 | 值 | 语义 |
| --- | --- | --- |
| `env='0'` | 杀开关 | **永不违逆**（最高优先级） |
| 文件配置 | `enabled` | 用户显式选择，高于种子 |
| `env='1'` | **首载种子** | 仅当文件没有该键时生效（"默认开"的一种表达） |
| 注册表默认 | `enabledDefault`/`defaultOn` | 兜底 |

## 2. 红线

- 不改 `env='0'` 的杀开关语义；不改阈值数值与校准键。
- 同一提交里显式改写 `block199-config-compat` 中"env=1 强制开"的钉法（留因），不许静默改基线。
- 不动设置页/REST 契约形状（只动"env=1 的胜负"）。

## 3. 落地记录（2026-10-18）

- **C-32 清偿**：`resolvePointEnabled` 改为显式四层（`env='0'` 杀 > 文件 > `env='1'` 种子 > 注册表默认），不再依赖通用 `resolveConfigLayers` 的 env 层——因为本族 env 有两义，硬塞进通用模型会让所有族背上只有本族用到的形状。
- **假警报一并修**：`shared-config` 的 `decision-points` 标 `envOneIsSeed: true`，`envShadowedKeys` 对 seed（`env='1'`）**不再报遮蔽**（否则 doctor 天天说"被 env 盖住"，而实际没盖）。
- **基线显式改写**：`test/block199-config-compat.test.mjs` 里"env=1 强制开"的钉法在同一提交改写为"seed 语义"，并留因（修的是"设置页关不掉"的治理缺陷，不是放宽判据）。
- 证据：`test/block211-c32-env-seed.test.mjs` **4/4**（真相表 / envOverride 保留 / seed 不报遮蔽 / 族标记）+ 邻域 **150/150**（112/113/116/119/173/199/200/202 + 新测）。
- **发现一笔在册旧账（未修，非本批引入）**：`test/block110-p1-topic-shift.test.mjs` 有 **5 例在 HEAD 上就红**（noul 三区间 / 降级 / 杀开关，全部断 `callModelTask` 调用数）。A/B 验证：`git stash` 掉本批改动后同样 5 红 ⇒ 与本批无关，需独立 triage。

## 4. 🟡 triage 记录：`block110-p1-topic-shift` 5 例 HEAD 红（2026-10-18）

**结论：与本批无关，且不是产品回归——是测试夹具的隔离缺陷。**

证据链：
1. **A/B**：`git stash` 掉 C-32 改动后同一文件仍 5 红（1 pass / 5 fail），恢复后同样 5 红 ⇒ 与 C-32 无关。
2. **失败形态**：5 例全部断"应当走到大模型路径"（`callModelTaskCalls.length === 1` 实得 0），日志里伴随
   `[topic-shift] failed: database disk image is malformed`——即查询抛错后被 `_maybeDetectTopicShift` 的
   try/catch 吞掉，函数返回 null。
3. **排除产品 DB**：仓库里 `core/petri-server/petri.db` 的 `PRAGMA integrity_check` = **ok**（335KB 遗留件本身没坏）。
4. **排除"路径本身不可用"**：按测试同样的方式自举（14 个 `src/migrations/*.sql` → `PETRI_DB_PATH` 指向临时文件）
   后，独立脚本 require `conversations` 并调用 `_maybeDetectTopicShift` **不抛 malformed**（返回 null，属门禁/依赖差异），
   说明报错只在**测试夹具（mock 注入 + 自举顺序）**这套组合下出现。

判断：`core/petri-server/db/connection.js` 的 `DB_PATH = process.env.PETRI_DB_PATH || <core>/petri.db` 是**模块加载时**求值；
测试在 `installMocks()` / require 链里可能先摸到连接，而自举只跑了 `src/migrations`（桌面侧），后端表由
`helpers/conversations.js` 自带 `CREATE TABLE IF NOT EXISTS` 创建——**自举范围与连接绑定两者都在夹具侧**，
不是 `conversations`/`decision-config` 的行为问题。

处置建议（单独小批，不混进 C-32）：修夹具而不是修产品——
① 在**任何 require 之前**固定 `PETRI_LOCAL_DATA_DIR` 与 `PETRI_DB_PATH`；
② 用 `conversations` 自己的建表路径初始化（而不是只跑 `src/migrations`）；
③ 断言里不要依赖"malformed 被吞成 null"这种形态。修完应 6/6。
