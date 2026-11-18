---
capability: block469-img2threejs-shim
status: completed
kind: work-package
truthDomain: block469-img2threejs-shim
entrypoint: docs/README.md
goal: S5 img2threejs 借形封装首片（R4 = B-5 延续）——只读核实上游评估（IMG2THREEJS-EVALUATION.md，不安装不联网）后，把其质量门禁范式（script-enforce + fail-closed + pass-gated + per-region confidence）抽成受治理封装骨架 sidecars/img2threejs-shim/spec-gate.mjs（纯 JS，无 Python/无外部服务），加契约测试；外部 AI 服务默认关、零整包安装、不装宿主目录
acceptance:
  - 零整包安装证明：零 img2threejs 包/宿主目录/Python runner/.img2threejs state 落仓（grep + find 取证），上游仅只读评估文档，不发起网络抓取
  - HK-01 红绿先行：spec-gate 契约测试先红（模块缺席）后绿——fail-closed（strict gate 失败出 BLOCKED 不写 factory）/ pass-gated 阶段序列 / per-region confidence 阈值 / 外部服务默认关（显式开启才允许）/ 白名单 schema；篡改负测
  - 借形边界在册：封装仅抽范式（不复制上游 90 Python 脚本/不复制品牌文案）；外部服务（hosted TRELLIS/Context7/SAM2 等）默认 deny，遵循 P5-a 确认
  - 零新增产品依赖（纯 JS sidecar）；不碰 agent 内核/SceneSpec/capability 开合；观感 pending_human_eye 不代签（本包无 UI 面）
  - closeout 定向门禁 + impact-map 登记 + 六件套回写
---

# BLOCK-469 · S5 img2threejs 借形封装首片（completed / SHIM-LAUNCH→CLOSED）

> **发令**：用户 2026-11-18 预授权 R4 = img2threejs 借形封装首片（五步串行 S5 最后一步；B-5 延续）。
> **从属**：`acceptance/next-stage-super-blueprint-2026-11-17/IMG2THREEJS-EVALUATION.md`（只读评估）+ `docs/3d-authoring-dependency-ruling-2026-11-17.md` §U-3D-D5（ruled：借形封装、不整包、外部服务默认关）+ `docs/petri-master-charter.md`。

## 1. 范围（scope）

1. **只读核实**：复核 IMG2THREEJS-EVALUATION.md（v2.0.1/Apache-2.0/~90 Python stdlib 脚本/五阶段 + 门禁类型全表）+ U-3D-D5 裁决原文；**不联网、不装包、不进宿主目录**（零整包安装证明落 acceptance）。
2. **借形封装骨架**：`sidecars/img2threejs-shim/spec-gate.mjs`——纯 JS（零 Python/零依赖），把上游门禁范式抽成受治理的 `ObjectSculptSpec` 形状校验 + 阶段门禁状态机：
   - fail-closed：`evaluateSpecGate(spec)` 违反 strict 规则 → `{ verdict:'BLOCKED', factoryEmitted:false, diagnostics[] }`（不写 factory，不冒充成功）；
   - pass-gated：`advanceGate(state, pass)` 仅按序解锁（intake→spec→build→review→rig），跳阶/重复返回拒绝；
   - per-region confidence：每个 region 有 `confidence ∈ [0,1]`，低于阈值 BLOCKED（评估 L65 "confidence→evidence" 思想）；
   - 外部服务默认关：`externalServices.allow` 默认 `[]`，任何非白名单服务名一律拒绝（P5-a 确认才可显式开）。
3. **契约测试**：`test/block469-img2threejs-shim.test.mjs`（HK-01 红→绿）——上述四条 + 篡改负测 + 零依赖面断言。

## 2. 非范围（exclusions）

- 整包安装 / Python 脚本复制 / npx install / doctor / 宿主目录写入（红线：不整包）；
- 外部服务实际调用（hosted TRELLIS/Context7/SAM2/Depth Anything 等，默认关且本包不接 transport）；
- 真正从图重建（来源 C runner）/ SceneSpec 归一 / capability 开合 / agent 内核 / 观感代签；G1+。

## 3. 验收门禁与证据

- **G1 红绿**：`node --test test/block469-img2threejs-shim.test.mjs` 先红后绿。
- **G2 零整包证明**：find/grep 无安装痕迹 + 纯 JS 无 product 依赖 + 上游只读。
- **G3 治理**：docs/ui-audit/closeout 定向 + impact-map + knip 动态入口定性（如需要）+ 六件套。

## 4. 完成语义

G1–G3 全绿 + 六件套 + 证据落 `acceptance/block469-img2threejs-shim/`。本包无观感面（sidecar+测试+证据），如实登记。零整包、外部服务默认关、零训练/外部依赖。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 5. 收口记录（2026-11-18）

G1 红→绿 7/7（HK-01，含零整包安装证明 + 外部服务默认关 + 零依赖面）；G2 零安装 find/grep 取证 + 纯 JS 无 product 依赖；G3 knip 346 键冻结无新增 + lint ledger 2441 + docs/ui-audit/closeout 见 AUDIT-LOG。证据=acceptance/block469-img2threejs-shim/。零观感面。

G0 开发期常态 · 不外推 packaged/Provider/GA。
