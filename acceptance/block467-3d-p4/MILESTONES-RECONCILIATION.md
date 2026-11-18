# 3D 造物域 §9 里程碑对账（BLOCK-467 / P4 · 2026-11-18）

> 依据：`docs/3d-authoring-domain-blueprint-2026-11-17.md` §9（L176–L186，M0–M4 五行，原表**无状态列/无 BLOCK 编号**）。
> 状态口径：AUDIT-LOG 收口条目 + docs/README registry + acceptance 证据三处现读；冲突时以收口证据为准。
> 诚实纪律：M2 部分闭环不冒充全闭环；BLOCK-461 属 W11 非 3D 明确排除；mapping-verdicts.json 陈旧产物不引用为结论。

## 1. 逐条对账

| 里程碑 | 出口判据（§9 原文） | 对应阶段 | 当前状态 | 证据路径 | 诚实缺口 |
|---|---|---|---|---|---|
| **M0 映射可行** | extras schema 实测 + 字段映射契约红绿 | P0 | ✅ 已闭环 | `acceptance/block-459/evidence.json`（verdict=PASS，4 direct + 2 convert 映射，probe-rest.glb sha256 2e803be3…）；`PROBE-REPORT.md` | `mapping-verdicts.json`（L2–L47）为陈旧中间产物（jointExtrasNodes=0/六行全 gap），与 PROBE-REPORT 矛盾，不作结论依据；按收口条目+报告登记 |
| **M1 最小闭环** | 一个可动装配：程序→GLB→IR→渲染，确定性 digest 一致 | P1 | ✅ 已闭环 | `acceptance/block460/e2e-cabinet.scene3d.json`（joints[] L32–L63 + provenance L64–L72）；BLOCK-460 收口（docs/README L9 completed）；蓝图 §4.1 经实探修正为 SceneSpec v1 additive joints[]（蓝图 L70） | 渲染由 P3/BLOCK-463 承接；P1 出口的"IR"=SceneSpec v1（非新建独立 IR，charter §3.2 禁止第二真相） |
| **M2 证据闭环** | 一份产物的验证结果 sha256 可复现 | P2 | 🟡 **部分闭环** | `acceptance/block462/evidence.json`（verdict pass，渲染证据双跑 PNG sha256 一致 67c9b6b3…、digest 8a7500d4…）；`test/block462-verify-adapter.test.mjs` 6/6 | verify adapter（validate/render/sim）已收口，但 **Agent Gym 编排（P2 任务卡之一）留本次 S3 补**——`sidecars/three-live-runner/README.md` L58「编排留后续按需」；故 M2 只记部分闭环，不冒充 |
| **M3 领域可扩展** | 加一个领域 viewer 不动内核（配方复验通过） | P3 | ✅ 已闭环 | `docs/AUDIT-LOG.md` BLOCK-463 收口（SceneSpec 证据面板上屏 + ::compose↔Result Studio 双形态互达 + 内核面零 diff 证明 bd0d5357..HEAD=0 行） | 观感 UI-710 pending_human_eye 不代签（in_progress）——不影响 M3 机制闭环判据 |
| **M4 收口** | closeout 门禁全绿 + 实机证据在册 | P4 | 🔵 本次对账（BLOCK-467） | 本文件 + `acceptance/block467-3d-p4/gym-evidence.json` + closeout 门禁摘要 | 本包交付=§9 对账 + Agent Gym 编排首片（gym_reset/step/close 语义）+ 证据 sha256；"实机证据"=three-live 隔离工具真跑观察（非 packaged/Provider，G0 常态不外推） |

## 2. BLOCK ↔ 里程碑映射（防误挂）

| BLOCK | 归属 | 说明 |
|---|---|---|
| BLOCK-459 | M0 / P0 | 3D 可行性探针（已闭环） |
| BLOCK-460 | M1 / P1 | SceneSpec v1 joints additive（已闭环） |
| **BLOCK-461** | **W11 Gen UI ::compose（非 3D）** | **明确排除，不计入任何 3D 里程碑** |
| BLOCK-462 | M2 / P2 | 验证闭环 L4（部分：gym 编排留本次） |
| BLOCK-463 | M3 / P3 | 呈现层 L3/L5（已闭环） |
| BLOCK-467 | M4 / P4 | 本次对账 + Gym 编排首片 |

## 3. 结论

§9 五里程碑：M0/M1/M3 全闭环、M2 部分闭环（gym 编排本次补）、M4 本次对账动作。无一步冒充 qualified/verified 越过证据。3D 域从 P0 到 P4 的机制链（探针→SceneSpec→验证→呈现→编排）在本轮六包（459/460/462/463 + 本次 467）中闭合；观感面（UI-710 等）保持 pending_human_eye 归用户。

G0 开发期常态 · 不外推 packaged/Provider/GA。
