# HK-04 P0：能力级规格层（Spec Layer）设计稿

> 状态：P0 勘察+设计收口（2026-09-26）；P1 试点裁决在用户。
> 来源：HK 系列（backlog 推进队列）；缺口锚点=OpenSpec delta 思想对照——工作包收口后「某能力当前应该是什么行为」无单点可查，行为要求散在 roadmap / plan 正文 / ui-audit 台账 / IPC registry 四处，跨工作包不可机读。
> 本文档是规格层设计的 canonical（truthDomain: `spec-layer-design`）。

## 1. 现状盘点（P0 勘察结论）

- **plan 文档**：存量 ~330 份，抽样（block-121/119/105、roadmap）**全部无 YAML front-matter**；状态/验收/重开条件全在正文引语与 §N 节——人读友好，机读不可。
- **DOC-REGISTRY 条目**=（id/path/kind/status/canonical/truthDomain/entrypoint/registeredAt/tags/archivePolicy）：只描述**文档生命周期**，不描述**能力行为要求**；校验器验字段类型与 canonical 必填，不拒未知字段（增量字段零破坏）。
- **docs:check 校验面**：registry schema / 路径失效 / 入口断链 / truthDomain 唯一 / 管理覆盖；无 front-matter 概念。
- **已有机读契约（规格层不重复建设）**：IPC channels registry（双向测试守护=通道契约）、ui-audit 台账（UI 状态机）、knip 棘轮 / impact-map（工程面）。缺的只是「能力级行为要求」这一层的**单点索引**。

## 2. 设计：四键 front-matter + registry 增量 + docs:check 增量

**plan 文档 front-matter 四键**（可选采纳，P1 试点 2-3 份）：

```yaml
---
capability: result-loop          # 能力标识（跨工作包稳定名，命名空间唯一）
goal: >-                         # 一句话行为要求（当前态应是什么）
acceptance:                      # 验收判据指针（flow 名/测试名/证据目录）
  - block121-result-loop 20/20
reopen: >-                       # 重开条件（观察态语义；无则省略）
status: completed                # 与 DOC-REGISTRY status 一致（校验看住漂移）
---
```

- **registry 增量**：entries 可选 `capability` 字段；同 capability 多文档（原 plan 与其加映/续批）合法，报告按 capability 聚合——回答「这个能力现在由哪些文档承载、最新态是哪个」。
- **docs:check 增量校验（只加不改）**：①受管文档若有 front-matter 则四键格式必查（缺键/格式错=红）；②front-matter.status 与 registry.status 一致性（防第二真相漂移）；③capability 命名空间唯一。**零 front-matter 文档零影响**（增量采纳，无迁移墙）。
- **查询面**：P1 不建服务——`npm run docs:status` 增 capability 聚合视图（读 registry+front-matter 单次扫描）。

## 3. 反目标（明确不做）

- 不引 OpenSpec CLI / `openspec/` 目录（第二套治理）；不建 specs/+changes/ 双目录（本仓 plan 文档 + backlog 队列已是 changes 载体，缺的只是「当前态」机读索引）。
- 不强制回填 330 份存量：**增量采纳**——新 plan 立项即带，存量文档收口/顺手触及时补。
- front-matter **不是第二账本**：正文仍是 canonical 叙述，front-matter 是其机读投影；两者漂移由 docs:check 一致性校验看住（可机械核对的面只做 status；goal/acceptance 语义对账仍归评审与 output:judge）。

## 4. P1 试点方案（裁决点）

- **选样 3 份**：`block-121-result-loop-vertical-plan.md`（最新 completed 垂直切片）/ `block-119-output-judge-harness-plan.md`（含观察态 reopen 语义）/ `g0-result-studio-plan.md`（长线 Goal 型，测 reopen 键表达力）。
- **交付**：三份 front-matter 补齐 + docs:check 增量校验实现 + docs:status capability 视图 + 校验器契约测试。
- **判据**：三份试点 docs:check 绿 + 一致性校验抓真演示（手改 status 制造漂移→红→还原）+ 既有 281 份文档门禁零回归。

## 5. 裁决记录

- 2026-09-26 P0 勘察+设计收口；P1 试点裁决在用户。
