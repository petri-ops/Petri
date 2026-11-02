---
capability: block-336-worktree-infrastructure
status: active
goal: worktree 通用基础设施 v1（用户裁决 2026-11-02「加 全方位的加」）：把 docs/worktree-governance.md 八节纪律从休眠文档变成机械可用的产品能力——agent 工具面（create/list/status/remove/merge-request 四档权限管）、项目层（worktreeOf 声明式副本，workspace_path 自动指向）、契约机械化（一树一分支一包 + 环境隔离端口约定）、治理留痕（生命周期全审计）。消费者：BLOCK-335 自优化闭环（第一个用户）、并行多任务、大胆实验副本、用户"试试看"。
acceptance:
  - P1 工具面四件：workspace_worktree_create（源仓+分支+路径约定，四档权限+审批+observe 档可用）/ list（含 ahead/behind/脏树状态）/ remove（干净树才可删，脏树 fail-closed 报明）/ merge_request（不自动 merge——生成改动摘要+diff 引用，合并动作留人工）。契约测红绿（含 .git 敏感段/越界/symlink 复用既有守卫）。
  - P2 项目层：createProject/updateProject 接受 worktreeOf:<projectId>（校验源仓是 git 仓、自动 git worktree add、workspace_path 指向副本、约定目录 <dataDir>/worktrees/<projectId>）；删除项目联动清理副本（脏树需显式确认）。REST + 契约测。
  - P3 契约机械化：governance §4 一一对应（一树一分支一 Agent 一包）+ §5 环境隔离（副本端口约定：PETRI_WORKTREE_PORT_BASE 偏移派生）做成 `helpers/worktree-contract.js` 纯函数 + 校验测试；生命周期事件（create/remove/merge-request）落 task_events + 审计 jsonl。
  - P4 实机腿：隔离后端全链——建副本→agent 在副本内改文件→list 显示脏树→merge_request 出摘要→清理；worktree-governance §3～§8 逐节对账表（每节=已实现/未实现如实）。证据 acceptance/block-336/。
  - P5 治理回写：worktree-governance.md 状态从休眠转"基础设施就绪（v1），按 §3～§8 正式流程使用"；335 plan 的撞裁决点①关闭（指向 336 交付物）。
reopen: 多副本并发写同一主仓的合并队列（v1 单副本串行）；worktree 内跑完整后端实例（v1 只约定端口，不做自动装配）；远端分支推送策略。
---

# BLOCK-336-WORKTREE-INFRASTRUCTURE — worktree 通用基础设施 v1 计划

- 立项裁决：用户 2026-11-02「加 全方位的加」（承接同日问答确认"有纪律无基础设施"——治理八节在、工具面为零）
- 登记状态：**active（2026-11-02 接手启动：BLOCK-334 收口后 Jev `next:suggest` 单一建议=BLOCK-336（confidence 0.25，如实），用户「行 按照建议来」发令；P1 本会话）**
- 唯一真相域：本文件（block-336-worktree-infrastructure）
- 文件面隔离：agent-tools git 域、db.js 项目层、新 helpers/worktree-contract.js、routes 项目路由；与 334（前端结果面）/335（workflow+checkpoint）零交叠。

## 1. 定位（立项自检问句）

ZCode/Codex 的 agent 没有面向 agent 的 worktree 能力（人手工 git 操作）；Petri 把治理纪律（governance 八节）做成 agent 可用、机械校验、全程审计的产品能力——本地可审计的并行安全面。不做哲学：每一节纪律直接翻译成一个校验函数或一个工具参数。

## 2. 与 governance 八节的对账（每一节 → 本包动作）

| § | 纪律 | 本包动作 |
| --- | --- | --- |
| §3 适用标准 | 重开条件成立才用 | 用户 2026-11-02 裁决即重开点；基础设施就绪后 335 触发首次使用 |
| §4 一一对应契约 | 一 worktree 一分支一 Agent owner 一 bounded 包 | `worktree-contract.js` 纯函数 + 注册表（`<dataDir>/worktrees/registry.json`）机械校验 |
| §5 环境隔离 | 端口/userData/SQLite/产物/日志隔离 | 端口偏移约定（PETRI_WORKTREE_PORT_BASE 派生）进契约函数；其余随消费者（335）落地 |
| §6 同步与合并 | 经 git 提交或评审补丁流，绝不目录拷贝合并 | merge_request 工具只出摘要+diff，合并动作=人工 |
| §7 保留与移除 | commit/快照→合并或显式保留→干净状态→Artifact 检查后移除 | remove 工具四步前置校验，脏树 fail-closed |
| §8 集中管理 | 登记表 | registry.json 单源（谁创建/何时/分支/状态/包） |

## 3. 红线

- 不自动 merge、不自动删脏树、不绕四档权限；worktree 操作全部走审批通道（observe 档首批可用）。
- 不碰 `.git` 对象库内容（既有敏感段守卫不动）；registry.json 是唯一登记源（不建第二台账）。
- 消费顺序：336 交付前 335 不得开工（335 的隔离方案直接消费 336 的项目层声明）。
- G1+ 不外推。

## 4. 体量与顺序

2–3 天；P1→P2→P3→P4→P5 串行；与 334 零交叠可并行开（若接手 Agent 在制则排其后）；335 依赖 P2。

## 5. P1 收口记录（2026-11-02 接手会话）

**接手起点**：上一会话已产出实现体（`helpers/worktree-contract.js` 193 行 + `agent-tools/worktree-tools.js` 302 行 + `tool-defs/worktree.js` + `registry.js` 引用/handler/contract + `tool-metadata.js` 四档审批），最后写入停在 18:24；**缺口=零测试、六处契约基线未同步、lint 1 error**。

**本会话交付**：

1. **契约测试** `test/block336-worktree-infrastructure.test.mjs` **10/10**：纯函数六组（分支名白名单含控制字符/目录形状/§4 四类违规一次报全/§5 端口派生/§7 porcelain 解析/§8 登记表损坏 fail-closed）+ 工具面四组（真 git 临时仓：create 建目录登记审计 → 造脏树 list 可见且 remove 拒绝列文件 → 清理后删且**分支保留**；§4 重复分支/重复包拒绝且不留目录；§6 merge_request 出摘要 `merged=false` 且**主仓 HEAD 不变**；未合并 ahead 拒绝、`allowUnmergedAhead` 才删目录；目录被外部删只收登记并 prune；非 git 仓/参数缺失如实 fail-closed）。**守卫落点**：工具不接受调用方指定路径（`worktreeDirFor` 在 `<dataDir>/worktrees/` 下唯一派生）⇒ 越界写、`.git` 敏感段不可达；分支名白名单拒绝 `-` 开头与非法 ref ⇒ 参数注入不可达；`git` 调用一律 `execFile`（无 shell）。
2. **实现抓真一处**：`listWorktrees` 的 `gitKnown` 在 macOS 上恒 false——`os.tmpdir()`/dataDir 给 `/var/...`，`git worktree list --porcelain` 给 `/private/var/...`，字面比对不相等。修法=两侧 `realpathSync` 归一（失败回落 `path.resolve`），不污染 registry 存储路径。
3. **lint**：分支名校验的 `no-control-regex`（控制字符正则）改为按码点判定（等价语义，不写 suppress 豁免）；测试补 `\u0000`/`\u007f` 两例。
4. **契约基线六处**（属「有意增长」=worktree 域 +4）：`agent-tool-registry` 104→108（两处）、`block116` 四件套计数、`block157` 静态面计数、`tool-activity-labels` 108 宇宙、`block113` 域集合补 `worktree`、`block325` 预算基线（count 108 / chars 58263 / perTool 540·225·450·434）；理由随本笔提交留痕。
5. **标签双端同源**：fixture + 后端 `tool-events` verbs + 前端 `toolActivity` verbs/icons 各 +4，记入**既有 UI-437 条目**（守卫型映射扩展、不新开 id——新开 in_progress 会顶破 BLOCK-332 证据债棘轮 live-missing≤5，且该面本就由 UI-437 的「fixture 全量宇宙」契约覆盖）；真实调用下的活动行外观留 P4 实机腿取证。

**门禁**：tsc 不适用（本包零前端类型面改动，仅 `toolActivity.ts` 常量表）· `quality:lint` 0 error / 2162 存量 warning · `gate:code-size` PASS（24 文件基线持平）· `gate:arch-cycles` PASS（13 环无新增）· `quality:arch` PASS · `docs:check` PASS（453 文档）· `ui:audit:check` 随 UI-660 登记后待复跑 · 定向测试 **580 项 572 绿**。

**遗留（非本包文件面，如实登记）**：① `test/block112-intent-routing.test.mjs` 六项既有契约漂移红——`shouldUseChitchatFastPath` 已改为 P4 配置中心运行时 `getPointRuntime('intent-route')` 判定，测试仍按「env 即开关」旧契约断言（HEAD 现状，两个文件本包均未触碰）；② `p6` 源绑定红=工作区未提交（脏树语义，提交后自愈）。

**未做（后续片）**：P2 项目层 `worktreeOf` / P3 契约机械化接线（端口装配、task_events 落点）/ P4 隔离后端实机 + governance §3～§8 对账表 / P5 governance 回写。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. P2 收口记录（2026-11-02 同会话续片）

**交付**：①迁移 `src/migrations/021_project_worktree_of.sql`（`projects.worktree_of TEXT`，存量 NULL 零变化）；②新 `helpers/project-worktree.js`（208 行：`attach`／`detach`／`inspectDirty`／`resolveSourceRoot`／`mainRepoRootOf`／`ensureProjectWorktreeColumn`／`resolveWorktreeOfUpdate`，**同步** `execFileSync` 以匹配 DB 层同步签名）；③`db.createProject/updateProject/deleteProject` + `inspectProjectWorktree`；④`api-data.js` 的 POST/PUT/DELETE（透传 `worktreeOf`、400 带 code、DELETE `?confirmWorktreeDirty=1` 与 **409 前置**）。

**设计裁决（对计划字面的收窄，理由在此留痕）**：
- **updateProject 的 worktreeOf 只支持三态**：同值幂等 / `null` 解除声明 / 其余一律 `worktree_rebind_requires_new_project`。原因=改挂会静默改写 `workspace_path` 归属（产物、血缘、批注 scope 全锚在这条路径上），破坏可审计性；重挂请新建项目。
- **DELETE 脏树预检放在删会话/记忆之前**（路由层先 `inspectProjectWorktree`）。若沿用原顺序（先删 `copilot_messages`/`copilot_conversations` 再删项目），409 会留下「项目还在、对话没了」的半删除态。
- **确认后强删用 `--force`**：`git worktree remove` 对脏树一律拒绝，显式 `confirmWorktreeDirty` 即授权强删，并把 `reason=confirmed_dirty` 落审计；**分支永远保留**（§6 合并留人工）。
- **加载期自愈加列**（`ensureProjectWorktreeColumn`）：带 `worktree_of` 的 prepared 语句在未跑 021 的旧库上会 prepare 失败并炸掉整个 db 模块（`test/tool-job-conversation.test.mjs` 的 legacy 种子库实测抓到）。与迁移 021 幂等共存。
- **code-size 台账登记**：`db.js` 1476→1525（+49，总基线 23353→23402）。已先把自愈加列与 worktreeOf 三态判定抽进 helper 才登记，剩余增量=createProject 分支 + 预检 + delete 联动 + 两条 prepared 语句。

**契约测试** `test/block336-worktree-project-layer.test.mjs` **8/8**（真 git 源仓 + 真 express 起服务）：迁移列存在／create 建副本且 `workspace_path=<dataDir>/worktrees/<projectId>` + 分支 + registry + 审计／源不存在·非 git·ssh 三种 fail-closed／update 改挂拒绝+幂等+解除不动路径／delete 干净树（分支保留、registry removed）／脏树未确认拒绝并列文件且项目与目录都在／确认后删／非副本零回归／REST 全链（POST 透传、PUT 改挂 400、DELETE 脏树 409 含 dirtyFiles、`?confirmWorktreeDirty=1` 200）。

**门禁**：`test:changed` **705 项 690 绿**（7 红=1 p6 脏树自愈 + 6 block112 既有红，均非本包）· `quality:lint` 0 error · `gate:code-size` PASS（台账登记后）· `gate:arch-cycles` PASS（13 环无新增）· `quality:arch` PASS。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 7. P3 收口记录（2026-11-02 同会话续片）

**交付**：新 `helpers/worktree-events.js`（零项目依赖的事件写入器，连接由调用方注入）+ 五处接入——`worktree-tools` 的 create / merge_request / remove（正常与 dir_missing 两分支）、`project-worktree` 的 attach / detach。`buildCore` 增加 `database` 注入点（默认 `db.getDatabase()`，测试可传坏连接验降级）。

**语义分工（与 BLOCK-323 的既有裁定对齐）**：
- `worktree-audit.jsonl` = **治理证据**（永久、不被清扫）；
- `task_events` = **当下可观测**（会话内可读的生命周期流，随 agent 事件 30 天清扫）。
双写，后者 **best-effort**：写失败绝不影响 git 动作，也不伪造事件（被拒的删除不落 remove 行）。

**作用域**：一条 worktree 自成一条流，`task_id='worktree:<worktreeId>'`、seq 从 1 递增；项目层副本复用同一流，`payload.via='project-layer'`（agent 工具面为 `agent-tool`）；`payload` 固定带 `action`，remove 带 `reason`（`clean` / `dir_missing` / `allow_unmerged_ahead` / `confirmed_dirty`）。

**抓真一处（架构门禁抓到，非测试）**：首版让 `worktree-events` 静态 require `agent-task-store`，`gate:arch-cycles` 立刻报两条新环——`db → project-worktree → worktree-events → agent-task-store → db` 与直连 db 那条。修法=写入器改**零项目依赖**（只接 connection，直接 `INSERT INTO task_events`），依赖方向恢复单向。

**契约测试** `test/block336-worktree-events.test.mjs` **4/4**：create→merge_request→remove 同流 seq 1/2/3 且 payload 逐字段断言／被拒的脏树删除**不落** remove 事件／项目层 attach→detach 复用同流且 `via` 正确／坏连接下 create 仍成功、审计 jsonl 仍在、事件 0 行。

**门禁**：`test:changed` **713 项 698 绿**（7 红同上，均非本包）· `quality:lint` 0 error · `gate:code-size` PASS（db.js +1 → 1526，台账重打）· `gate:arch-cycles` PASS（13 环，本轮新环已消）· `quality:arch` PASS。

**未做（后续片）**：P4 隔离后端实机全链 + governance §3～§8 逐节对账表；P5 `worktree-governance.md` 状态回写 + 335 撞裁决点①关闭。

G0 开发期常态 · 不外推 packaged/Provider/GA。
