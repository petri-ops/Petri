---
capability: post-s7-h1-admission-fk-decision-material
status: reference
goal: 为 post-S7 H1 的两个 U 类裁决点（执行准入默认档 / SQLite 外键全量切换）提供一页决策材料：现状、候选、风险、推荐、证据；本文件不含实现，也不改任何默认语义。
acceptance:
  - 两个裁决点各有现状读数、候选方案、风险与推荐
  - 推荐与既有用户裁决的关系显式写明（不撤销、不提前生效）
  - 未裁决期间的系统行为如实描述
reopen: 用户下达裁决；或 H2/H4 改变错误码 / 装配面使读数失效
---

# H1 决策材料：执行准入默认档 · 外键全量切换

> 供用户裁决用。**Agent 未擅自生效任何一项**：两项当前均维持既有裁决态（observe / FK=OFF）。
> 证据基线与复跑命令见文末；本文件是材料，不是第二份状态真相（状态在 plan + registry）。

## 一、执行准入默认档（`PETRI_EXEC_ADMISSION`）

### 现状（BLOCK-386 交付后）

- 闭环已通：策略判定点签发一次性凭据（task / 指纹 / 上下文快照绑定），`workspace_exec` 执行边界出示并**真实消耗**（重放/过期/改写四类拒绝在生产路径可复跑）。
- 默认档仍是 `observe`：凭据照常消耗、判定结果照常透出（`executionAdmission{mode,reason}`），但**不拒绝执行**。
- 覆盖面：`workspace_exec` 一个执行边界。job 执行器（`tools-executor`）与远端 job（`ssh-direct-runner`）尚无凭据通道；MCP 插件脚本按两轴分离裁决不在本面。

### 候选

| 档 | 行为 | 需要的前置 |
| --- | --- | --- |
| A · 维持 observe（现状） | 只审计不拦；`workspace_exec` 语义不变 | 无 |
| B · 全量 enforce | 任何无凭据/凭据失效的执行请求被拒 | ①②③④ 全满足 |
| C · 分面 enforce | 仅 `workspace_exec` enforce，其余维持 observe | ①② |

前置清单：
① job / 远端 job 执行器接入凭据通道（否则这两个入口在 enforce 下会被误判为「无凭据」）。
② 全部调用面审计表（谁在什么路径下调 `executeCommand`，含非拦截器直调路径）。
③ 审计面确认 `executionAdmission.reason` 已进入可查证据（当前在工具结果里，未进 task_events）。
④ 一轮真实任务的 observe 数据（多少 missing / 多少 consumed），否则 enforce 的误伤面未知。

### 风险

- **误伤**：绕过拦截器直调 `executeCommand` 的路径（脚本、测试、路由）在 enforce 下会突然被拒，用户可见「命令莫名不执行」。
- **假安全**：若签发与消耗仍同进程相邻，enforce 拦的是「内部一致性」而非攻击者；它的真实价值是**链路完整性证据**，不是沙箱。
- 与用户裁决的关系：`workspace_exec` 黑名单默认放行是既有裁决，enforce 不改变「允许什么命令」，只改变「凭据在不在」。两者不冲突，但叠加后用户感知会变。

### 推荐

**A（维持 observe）**，并把 ④ 的 observe 读数收集作为下一阶段入场券。理由：前置 ①②③ 均未完成，此时 enforce 只会把「未接线」当成「不安全」报出来，属于把工程债伪装成安全收益。

## 二、SQLite 外键全量切换（后端 `foreign_keys`）

### 现状

- 桌面侧 `_db-singleton.js` `foreign_keys=ON`；后端 `db/connection.js` `foreign_keys=OFF`；`db-connection-policy.js` 刻意不把 FK 纳入 canonical pragma，并记「179 违约已回退 / 独立大包清偿」。
- BLOCK-386 已消除一处「依赖 CASCADE 才正确」的代码：删知识空间时显式删绑定行（FK=ON/OFF 行为一致），`knowledge-space` 50/50 绿。
- 挂起事实：**只要还有别处依赖 CASCADE，切换 ON 就会出现「看起来通过、实际静默不删」的反向隐患**——这正是要全量回归的理由。

### 候选

| 档 | 行为 | 代价 |
| --- | --- | --- |
| A · 维持 OFF（现状） | 后端不做引用完整性约束；依赖代码显式清理 | 债继续留在代码里，逐处靠人记住 |
| B · 全量 ON + 179 违约逐表清偿 | 运行时与桌面侧一致，引用完整性由 DB 兜底 | 需逐表迁移数据 + 全量回归；一次做错会丢行 |
| C · 分阶段：先加「FK 是否被依赖」静态扫描，再分批 ON | 每批都有独立证据 | 周期长，但风险可控 |

### 风险

- 全量 ON 前若仍有 `DELETE` 语句依赖 CASCADE，ON 之后行为**改变**（多删了子行）或报约束错——两种都属于数据面事故。
- 迁移连接与运行时连接 pragma 不同，会让「迁移期能过、运行时报错」类问题只在生产出现。

### 推荐

**C（分阶段）**，第一步只做静态扫描（列出所有 `DELETE FROM <parent>` 且无显式子表清理的语句 + 所有 `REFERENCES ... ON DELETE` 声明），产出「依赖 CASCADE 的语句清单」。清单为空后再谈 B。理由：B 是数据操作，动的是用户库；在清单为空之前启动 B 属于盲切。

## 证据与复跑

```bash
# 执行准入闭环（生产路径四类拒绝）
node --test test/block386-execution-admission.test.mjs
# 邻域回归（拦截器 / 四种 exec / 策略 / 链哈希 / manifest）
node --test test/agent-tool-policy.test.mjs test/agent-workspace-exec-*.test.mjs \
  test/nso-s2-execution-admission.test.mjs test/nso-s2-delivery-manifest.test.mjs
# 掉绑不依赖 FK
node --test test/knowledge-space.test.mjs
# 链校验默认 strict + 存量清单
node scripts/verify-artifact-chain.mjs .petri-dev-user-data/data/petri.db --inventory <out.json>
```

- 存量清单读数（dev 库，本机）：118 版 revisions，118 已哈希，**0 legacy_unhashed** → 默认 strict 在当次数据上零代价。
- 竞态与口径：本文件所有读数取自 2026-11-09 当次本机 dev 库；换机器 / 换库需重跑清单。

G0 开发期常态 · 不外推 packaged/Provider/GA。
