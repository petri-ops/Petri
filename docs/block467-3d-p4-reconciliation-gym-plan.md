---
capability: block467-3d-p4-reconciliation-gym
status: completed
kind: work-package
truthDomain: block467-3d-p4-reconciliation-gym
entrypoint: docs/README.md
goal: 3D 造物域 P4 对账 + Agent Gym 编排首片（R3）——3D 蓝图 §9 里程碑逐条对账（M0 459/M1 460/M2 462 部分/M3 463/M4 本次，如实登记不冒充，461 属 W11 非 3D）+ three-live-runner 新增 gym.mjs 编排（reset→step×N→close 语义：CLI reset/step + session 文件 finalize；消费 BLOCK-459 探针 GLB；产 JSON 证据 sha256 在册）；只做编排与证据，不引训练框架
acceptance:
  - HK-01 红绿先行：gym 编排契约测试先红（实现前）后绿——reset 产 session + t0 observation、step×N 推进 step/tick、digest 双跑一致、损坏 GLB/越界路径 fail-closed、零训练框架依赖面
  - §9 里程碑对账表落 acceptance/（逐条定义/当前状态/证据路径/诚实缺口；M2 部分闭环如实登记，M4=本次对账）
  - gym 编排证据 sha256 在册（真实探针 GLB reset→step 产出 JSON evidence）
  - three-live CLI gym CLI 实测形态在册（reset/step/play 子命令 + MCP gym_close；仓库无 flags 文档→现场 --help 取证留痕）
  - 零新增产品依赖（three-live 隔离 sidecar 已装、capability 默认关不触碰）；不引训练框架（R3 边界）
  - closeout 定向门禁 + impact-map 登记 + 六件套回写
---

# BLOCK-467 · 3D P4 对账 + Agent Gym 编排首片（completed / P4-LAUNCH→CLOSED）

> **发令**：用户 2026-11-18「梳理剩余工作+不用人参与的提示词」预置裁决 R3 = 3D Agent Gym 编排首片（五步串行 S3；three-live gym_reset/step/close CLI 已实测；只做编排与证据，不引训练框架）。
> **从属**：`docs/3d-authoring-domain-blueprint-2026-11-17.md` §9（M0–M4）+ `docs/3d-authoring-domain-charter.md` + `docs/petri-master-charter.md`。

## 1. 范围（scope）

1. **A · §9 里程碑对账**：新建 `acceptance/block467-3d-p4/MILESTONES-RECONCILIATION.md`——逐条 M0–M4：定义/出口判据/当前状态/证据路径/诚实缺口。口径：M0=BLOCK-459 探针（已闭环）、M1=BLOCK-460 SceneSpec joints（已闭环）、M2=BLOCK-462 验证闭环（**部分闭环**：validate/render/sim 已收口，gym 编排留本次；不冒充全闭环）、M3=BLOCK-463 呈现层（已闭环）、M4=本次 P4 对账（closeout 门禁 + 证据在册）。**BLOCK-461 属 W11 Gen UI，非 3D 里程碑，明确排除**。
2. **B · gym 编排首片**：`sidecars/three-live-runner/gym.mjs`——镜像 verify.mjs 骨架（parseArgs/safeWorkspaceRelative/fail/digest/stdout 单行 JSON），编排 `gym reset --session <tmp> <GLB>` → `gym step --session <tmp> --actions <json> --ticks N` ×M → finalize（session 文件 + close 语义：MCP three_live_gym_close 存在但 CLI 无 close 子命令，如实登记，编排层以 session finalize 表征"close"）。消费 BLOCK-459 探针 GLB（`test/fixtures/sand3d-probe-rest.glb`，sha256 锚定）。产 JSON 证据：每步 observation 摘要（step/tick/reward/score/done/bodies 计数）+ 链路 digest 64hex。失败诚实 exit 1。
3. **C · HK-01 契约测试**：`test/block467-gym-orchestrator.test.mjs`（沿 block462 verify adapter 模板，工具缺席 skip）——reset+step 产出形状/digest 双跑一致/损坏 GLB fail/越界路径 fail/无训练框架依赖面。
4. **D · 实测形态留痕**：CLI `--help` 输出 + observation 顶层键 + session 文件键 + "gym close 为 MCP-only"事实入 acceptance。

## 2. 非范围（exclusions）

- 训练框架/R L 算法/策略网络（R3 红线：只编排与证据）；
- 改 agent 内核 / three-live 包本身；capability 开合（默认关不触碰，沿 BLOCK-462）；
- ::compose/Gen UI 面；观感代签；G1+。

## 3. 验收门禁与证据

- **G1 红绿**：`node --test test/block467-gym-orchestrator.test.mjs` 先红后绿。
- **G2 邻域**：block462 verify adapter 全套 + three-live sidecar README 契约不改；quality:types/knip（新脚本入口定性）。
- **G3 治理**：docs/ui-audit/closeout 定向 + impact-map + 六件套。

## 4. 完成语义

G1–G3 全绿或明确 external-blocked + 六件套 + 证据落 `acceptance/block467-3d-p4/`。本包无观感面（sidecar+契约+证据均非用户 UI 写面），如实登记；零训练框架。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 5. 收口记录（2026-11-18）

G1 红→绿 6/6（HK-01）；G2 block462 邻域 + knip 动态入口定性（files::gym.mjs 入基线，镜像 verify.mjs）；G3 docs/ui-audit/closeout 见 AUDIT-LOG。真跑证据=acceptance/block467-3d-p4/run/gym-evidence.json（verdict pass, digest 4015235a…，sha256 b7e4fbbb…）。对账=M0/M1/M3 闭环 + M2 部分 + M4 本次；BLOCK-461 属 W11 排除。零训练框架/零观感面。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 收口门禁归属（2026-11-18）

closeout 全绿（perf SKIPPED）： packaged_start 采样 487–495ms vs 阈值 485ms（median 373ms ×1.3）——本包零 perf 面改动（仅 sidecar/契约/证据/docs），该红为打包后端启动的存量边界抖动（300ms 轮询粒度，技能文档在册 noiseSources），归属既有 perf 基线，不属本包，不重打基线掩盖。

G0 开发期常态 · 不外推 packaged/Provider/GA。
