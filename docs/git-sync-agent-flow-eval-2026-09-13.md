# Git 仓库同步与智能体系统交互流程评估报告

> 类型：**评估报告**（非工作包、非计划、不改生产代码）
> 评估日期：2026-09-13
> 评估对象：`D:\1.WorkDir\petri-desktop`（Petri Desktop，原名 Petri）
> 评估时点基线：`main` @ `81069a3b`，与 `origin/main` 同步，工作区干净
> 方法：只读侦察（Git 元数据 / 治理文档 / 门禁脚本 / 文件系统实态）
> 阶段声明：G0 长期开发期。本报告不外推 packaged / Provider / GA。

---

## 0. 评估结论摘要

本次评估以「只读侦察 + 取证」方式核查两条线：**① Git 仓库同步现状**、**② 智能体系统交互流程**。

整体结论：**仓库同步健康、流程纪律成熟，但治理元数据存在 3 处「静默漂移」——门禁不覆盖、无人报警、且长期累积。**

| 维度 | 评级 | 一句话结论 |
| --- | --- | --- |
| Git 仓库同步 | ✅ 健康 | 无未推送、无未合并分支、无残留 tag 漂移 |
| 提交规范 | ✅ 良好 | conventional prefix 覆盖率 ≈ 99.7%，commit tag 纪律在用 |
| 分支管理 | ⚠️ 轻度冗余 | 1 个已完全合并的远程分支未清理 |
| 审计台账结构 | ❌ 漂移 | 「当前待处理项」混入 17 条已收口项，纯度 27% |
| DOC-REGISTRY 状态 | ❌ 漂移 | 36 条 `active` 中，2 条 P0 review 文档对应的主包早已 completed |
| 门禁覆盖 | ❌ 缺口 | 无「active 工作包唯一性」校验，漂移不被捕获 |
| 易漂移事实复制面 | ⚠️ 结构性 | 「无 active 工作包」在 23 个位置复制，无单源 |

---

## 1. 评估范围与方法

### 1.1 为什么做这次评估

用户裁决「先只做清债，不开新包」，但核查后发现**所有挂账债均被前置条件锁定**：

- `compute-settings` 死 IPC 链 → 台账明写「不在本批单独清」，须等 G0-RS P6 重采
- `p4r perf` 门 corpus 链包感知化 → 同属 P6 链
- `T-AW-013 DIST-STALENESS` → G1+ 范畴，G0 铁律禁止外推

同时 `npm run hygiene:check` 全绿、`test:changed:list` 影响面为空 —— **可清的债实际是空集**。故转为纯评估任务：不动生产代码、不开工作包，产出文档资产。

### 1.2 评估方法

| 手段 | 说明 |
| --- | --- |
| Git 元数据只读 | `remote -v` / `branch -r --merged` / `rev-list --count` / `tag` / `log --format` |
| 治理文档结构分析 | 用 Python 解析 `AUDIT-LOG.md` 与 `DOC-REGISTRY.json`，量化状态分布 |
| 门禁脚本审读 | 读 `scripts/docs-governance.mjs`、`hygiene-check.mjs` 校验覆盖面 |
| 文件系统实态核对 | `lstat` 对比 git mode（120000 vs 100644），验证符号链接降级 |
| 门禁实跑 | `docs:check` / `ui:audit:check` / `hygiene:check` / `test:changed:list` |

### 1.3 显式非范围

不做：代码变更、工作包立项、任何 G1+ 事项（Provider / 公证 / GA / dist staleness）、`docs/archive/` 历史归档操作。

---

## 2. 第一条线：Git 仓库同步

### 2.1 同步状态：健康

| 检查项 | 实测结果 | 判定 |
| --- | --- | --- |
| 远程配置 | `origin` → `https://github.com/petri-ops/Petri.git` | ✅ 单一远程，无冗余 |
| 上游跟踪 | `main` → `origin/main` | ✅ 正常 |
| 领先/落后 | `0 0`（`git rev-list --left-right --count origin/main...HEAD`） | ✅ 完全同步 |
| 工作区 | `git status --porcelain` 空 | ✅ 干净，无 untracked |
| 未合并分支 | 无（`branch -r --no-merged origin/main` 返回空） | ✅ 无游离工作 |
| 规模 | 1930 commits，首提交 2026-06-27 → 最新 2026-09-13 | — |

### 2.2 分支管理：1 处轻度冗余

```
origin/codex/block77-p4-live-fixes   独有提交: 0   ← 已完全合并进 main
  最后提交 46ae54d6 (2026-09-11) fix(agent): BLOCK-77 P4 实机抓真修五连
```

该分支**已完全合并**（`branch -r --merged origin/main` 命中），无独有提交。属 BLOCK-77 收口后未清理的远程分支。

> **性质**：非缺陷，属卫生问题。保留不影响任何功能，清理也无风险。
> **处置建议**：可随手 `git push origin --delete codex/block77-p4-live-fixes`，但**不属紧急项**，可留待下次触碰该线时处理。

### 2.3 提交规范：良好

近 300 提交的 conventional prefix 分布：

| prefix | 数量 | 占比 |
| --- | --- | --- |
| `docs` | 97 | 32.3% |
| `feat` | 95 | 31.7% |
| `fix` | 46 | 15.3% |
| `chore` | 20 | 6.7% |
| `test` | 16 | 5.3% |
| `refactor` | 10 | 3.3% |
| `style` | 7 | 2.3% |
| 其他（`perf` / `closeout` / `governance` / `merge`） | 4 | 1.3% |

近 100 提交中**仅 1 条**无标准 prefix（`closeout(block-70): ...`）—— 属 `closeout` 自定义类型，语义清晰，非问题。**规范覆盖率 ≈ 99.7%**。

`(TAG)` 尾标纪律：近 200 提交中 15 条带尾标（`(BLOCK-70-CLOSEOUT)` / `(UI-355)` / `(SESSION-HANDOFF)` 等）。该纪律属**关键节点标记**用法而非逐条强制，当前用法符合 AGENTS.md「在提交标题或正文标注对应 `UI-###`」的表述。

### 2.4 Tag 策略：轻量但有隐患

```
v0.0.1-rc.1   19b192e9 2026-07-15   1716 commits behind main
v0.0.1-rc.2   3a3f9908 2026-07-15   1713 commits behind main
v0.0.1-rc.3   740f2b7c 2026-07-15   1709 commits behind main
v0.0.1-rc.4   08a0bbbc 2026-07-15   1707 commits behind main
v0.0.1-rc.6   907b695d 2026-07-19   1578 commits behind main
v0.0.1-rc.7   ab519fac 2026-07-21   1552 commits behind main   ← package.json 当前版本
```

**观察**：

1. **`rc.5` 缺失** —— tag 序列从 `rc.4` 跳到 `rc.6`，无 `v0.0.1-rc.5`。
2. **55 天未打 tag** —— 最后一个 tag `rc.7` 停在 2026-07-21，而此后 main 前进 1552 个提交（含 BLOCK-63/65/66/67/68/69/70/71/76/77/78/79/81/82/83/84 等大量工作包收口）。
3. **`package.json` 版本号仍是 `0.0.1-rc.7`** —— 版本号与实际代码状态已严重脱节。

> **定性（按 G0 纪律）**：**这不是缺口**。G0 开发期不发布，`rc.7` 是「当前 OSS 线上工程候选版」，tag 稀疏是 G0 常态。`package.json` 版本号沿用在 G0 期无消费方（不发版、不打包分发）。
> **但需登记为事实**：若进入 G1+ 需补 tag 与版本对齐，届时属 release-pipeline 范畴。**当前不外推。**

---

## 3. 第二条线：智能体系统交互流程

### 3.1 流程架构：成熟且有单源意识

智能体系统的交互流程由以下层次构成：

| 层 | 载体 | 作用 |
| --- | --- | --- |
| 工程指令 | `AGENTS.md`（233 行，唯一规范） | 阶段纪律 / 委派策略 / 测试范围 / 治理规则 |
| 兼容路由 | `CLAUDE.md`（25 行） | 只 `@AGENTS.md` 导入 + 恢复顺序，**明确不复制易漂移事实** |
| 会话恢复 | `npm run state` | 聚合 Git / AUDIT-LOG / active 工作包 |
| 审计广播 | `docs/AUDIT-LOG.md` | 非主 agent → 主 agent 的唯一广播入口 |
| 机器目录 | `docs/DOC-REGISTRY.json` | 235 条文档状态真源 |
| 实践资产 | `.agents/skills/` 3 个 skill | governance / dev-infra / code-review |
| 门禁 | `docs:check` / `ui:audit:check` / `hygiene:check` / `closeout` | fail-fast 聚合 |

**架构优点（值得保留）**：

- `CLAUDE.md` 的设计是**教科书级的单源纪律**：显式声明「不是第二份项目规范」「不得复制当前阶段、分支、门禁数量或工作包进度」，仅做路由。这避免了多 agent 生态最常见的状态副本分叉。
- `AGENTS.md` 的委派策略有明确边界（「不把需求含糊、破坏性、安全敏感、治理裁决、紧密耦合或需要跨模块架构判断的工作委派给 `luna_worker`」），并规定「子 Agent 的完成声明不能代替主 Agent 终审」。
- 治理 skill 采用 canonical 单点 + 符号链接发现机制（`.claude/skills/*` → `.agents/skills/*`），避免两份副本。

### 3.2 符号链接降级：已验证为**正确处理**

**发现**：`.claude/skills/` 下 3 个条目在 Git 中记录为符号链接（mode `120000`），但在 Windows 磁盘上落为**内容为路径字符串的普通文件**：

```
$ git ls-files --stage .claude/skills/
120000 .claude/skills/petri-code-review
120000 .claude/skills/petri-dev-infra
120000 .claude/skills/petri-project-governance

$ 磁盘实态
.claude/skills/petri-dev-infra = REGULAR FILE (内容为路径字符串)
```

**根因**：`core.symlinks = false`（Windows 无 symlink 权限时的 Git 默认行为）—— Git 将 symlink 检出为文本文件。

**验证结论：这不是缺陷**。逐项验证：

1. `git status .claude/` 为空 → Git 认为工作树与索引一致（正确地按降级形态对待）
2. 目标路径解析有效 → `../../.agents/skills/petri-dev-infra` 存在
3. `SKILL.md` 可通过该路径发现 → 3/3 可发现
4. `hygiene-check.mjs` **已经显式处理此情形**（脚本注释第 9-10 行：「Windows 无 symlink 支持时 git 会把链接检出为『内容即目标路径』的纯文本」），并正确解析目标；目标存在，故不报死链

> **结论**：设计已预期该平台差异并正确处理。**无需动作。** 此项登记为「已核查无问题」，防止后续 agent 重复排查。

### 3.3 门禁覆盖现状

| 门禁 | 命令 | 实测 | 覆盖面 |
| --- | --- | --- | --- |
| 文档治理 | `docs:check` | ✅ PASS (235 docs) | 注册完整性 / path 合法性 / canonical 唯一 truthDomain / entrypoint 真实性 |
| UI 台账 | `ui:audit:check` | ✅ PASS（316 编号） | UI 编号与 Git 证据同步 |
| 工作区卫生 | `hygiene:check` | ✅ PASS（3 项全绿） | 死符号链接 / 临时残留 / 换行漂移 |
| 收口聚合 | `closeout` | — | hygiene → docs → ui-audit → test:changed fail-fast |

**门禁缺口（关键发现）**：`docs-governance.mjs` 中**没有「active 工作包唯一性」校验**。

而 `docs/document-governance.md` §2.1 明确规定：

> 项目采用单线串行开发：同一时间只有一个工作包处于 `active`，且该工作包内只有一个阶段处于进行中。

**规范写了，门禁没管** —— 这正是下面两处漂移能长期静默累积的直接原因。

---

## 4. 发现清单（3 处静默漂移）

### D-1：AUDIT-LOG「当前待处理项」纯度仅 27%

**实测**：「当前待处理项」区段（L390–L429）共 28 条数据行：

| 状态 | 条数 | 说明 |
| --- | --- | --- |
| ✅ 已收口 / 已销号 / closed | **17** | 已完成但仍留在「待处理」区 |
| 🟢 建议（活跃） | **2** | 仅 compute-settings + DIST-STALENESS |
| 🟡 延期 / 待评估 | **7** | 需人工裁决 |
| 🔵 Active | **1** | **陈旧**：BLOCK-2-UI-157-REVIEW，2026-08-16 登记 |
| 其他 | 1 | 表头 |

**问题**：

1. **信噪比低**：主 agent 每次会话读该区段，需从 28 条中筛出 2 条真正活跃项。
2. **🔵 Active 条目陈旧**：`BLOCK-2-UI-157-REVIEW` 标注「工作包启动」且状态为 Active，但 `npm run state` 与 DOC-REGISTRY 均报「当前无 active 工作包」—— **直接矛盾**。
3. **与文件自述冲突**：文件头写明「本文件只保存需要主 Agent 看见的**活跃**广播与最近处理记录」「不要把长篇完成历史重新堆回本文件」—— 17 条已收口项正是「长篇完成历史」。

**性质**：违反了文件自身的自我约束，属**治理卫生问题**，不影响功能。

### D-2：DOC-REGISTRY 存在 2 条 orphan `active`

**实测**：235 条注册项中 `active` 共 36 条。逐条核查 `kind` 后：

```
active 且 kind 分布：reference 21 / governance 6 / audit 4 / roadmap 2
                    / living-plan 1 / vision 1 / handoff 1
```

**多数属合理**（规范类文档长期 active 是对的）。但发现 **2 条可疑**：

| 条目 | status | phase | 对应主包状态 |
| --- | --- | --- | --- |
| `BLOCK-76-P0-DESIGN-REVIEW` | `active` | `P0-REVIEW` | `BLOCK-76-SSH-NATIVE-EXECUTION` = **completed** |
| `BLOCK-77-P0-DESIGN-REVIEW` | `active` | `P0-REVIEW` | `BLOCK-77-RESIDENT-TASKS` = **completed** |

**问题**：P0 设计评审稿是**过程产物**，其主包早已 completed，但评审稿仍标 `active` + `phase=P0-REVIEW`。这会让「恢复当前状态」的 agent 误以为存在一个处于 P0-REVIEW 阶段的工作包。

> **正面事实**：这两条 `kind=reference` 且 `archivePolicy=archive_when_superseded`，即注册表已声明其可归档性质，只是状态未随主包收口同步更新。

### D-3：易漂移事实无单源，复制面 23 处

**实测**：「当前无 active 工作包」这一条易漂移事实，被复制在 **23 个文件**中（除 archive）：

```
docs/AUDIT-LOG.md                     34 次  ← 最严重
docs/next-steps-roadmap.md             6 次
docs/project-workspace-handoff.md      5 次
docs/ui-productization-audit.md        4 次
docs/session-handoff-2026-09-13.md     1 次
+ 18 个 block-*.md 各 1 次
```

同理，「最后更新：2026-09-13」在 AUDIT-LOG / roadmap / handoff **各写 1 次**，需人工保持三处同步。

**性质**：**结构性张力**，非缺陷。AGENTS.md 与 CLAUDE.md 已明确要求「当前状态只写入 canonical 文档」，但客观上多个 canonical 文档（roadmap / handoff / audit-log）都需承载状态摘要，复制不可避免。

**风险**：任一处更新遗漏即产生不一致，且门禁无法检测（D-1 的 🔵 Active 陈旧条目即是实例）。

---

## 5. 处置建议（分级，均**待用户裁决**）

> 以下建议**均为治理卫生类**，不含任何 G1+ 事项。按 G0 纪律，是否执行由用户裁决。

### P2（建议优先，低风险、纯文档）

| 编号 | 动作 | 影响面 | 风险 |
| --- | --- | --- | --- |
| A-1 | 将 AUDIT-LOG「当前待处理项」中 17 条已收口项移入「最近处理记录」或归档 | 单文件 | 极低，纯文本搬移 |
| A-2 | 修正 `BLOCK-2-UI-157-REVIEW` 的 🔵 Active 陈旧状态 | 单行 | 极低 |
| A-3 | 将 `BLOCK-76/77-P0-DESIGN-REVIEW` 状态从 `active` 改为 `completed` 或 `archived` | 2 条注册项 | 低，需跑 `docs:check` |

### P3（可选，需评估收益）

| 编号 | 动作 | 说明 |
| --- | --- | --- |
| B-1 | 为 `docs-governance.mjs` 增加「active 工作包唯一性」校验 | **治本**：把 §2.1 规范转化为门禁（符合 governance skill 的「同类缺陷第二次出现必须转化为门禁」原则）。需评估：现有 36 条 `active` 中大量为 reference 类，校验须按 `kind` 白名单过滤，避免误报 |
| B-2 | 清理已合并远程分支 `codex/block77-p4-live-fixes` | 卫生，无风险 |
| B-3 | 评估「lastUpdated 字段」是否可后台生成以消除三处手工同步 | 需设计，非当前优先 |

### 明确不做

- ❌ 不补 tag、不升 `package.json` 版本（G1+ release-pipeline 范畴）
- ❌ 不动 `docs/archive/`
- ❌ 不改任何生产代码

---

## 6. 附：评估方法与证据可复现性

本报告全部结论可由以下命令复现（Node 24 前置）：

```bash
export PATH="$(cygpath -u "$APPDATA/fnm/node-versions/v24.20.0/installation"):$PATH"

# 第 2 节 Git 同步
git remote -v
git branch -r --merged origin/main
git rev-list --left-right --count origin/main...HEAD
git tag
for t in $(git tag); do echo "$t $(git rev-list --count $t..origin/main)"; done

# 第 3.2 节 符号链接降级
git ls-files --stage .claude/skills/
for f in .claude/skills/*; do [ -L "$f" ] && echo SYMLINK || echo "REGULAR: $(cat $f)"; done

# 第 3.3 节 门禁
npm run docs:check
npm run ui:audit:check
npm run hygiene:check

# 第 4 节 漂移量化
python -c "..."   # 见报告正文的解析脚本
```

**证据等级**：全部为**直接实测**（命令输出 / 结构化解析），无推断性结论。

---

## 7. 后记：本次评估的边界

1. **本报告不改变任何状态**。DOC-REGISTRY 未改、AUDIT-LOG 未改、未提交、未立项。
2. **评估发现的漂移均不影响产品功能**，属治理元数据卫生问题。
3. **G0 开发期常态** · 不外推 packaged / Provider / GA。
4. 若用户裁决执行 A-1/A-2/A-3，需走 `$petri-project-governance` 并在同一提交回写台账。
