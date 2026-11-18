# BLOCK-469 / S5 — img2threejs 借形封装首片证据（2026-11-18）

## 授权边界（只读核实，零整包安装）

- 发令：用户预授权 R4 = img2threejs 借形封装首片（B-5 / U-3D-D5 延续）。
- 裁决原文（docs/3d-authoring-dependency-ruling-2026-11-17.md:82）：「B-5 img2threejs = 借形封装，不整包、外部服务默认关」；执行边界=借形 + 受治理封装，不整包安装宿主目录，hosted 外部服务默认关。
- 上游事实仅读 `acceptance/next-stage-super-blueprint-2026-11-17/IMG2THREEJS-EVALUATION.md`（v2.0.1 / Apache-2.0 / ~90 Python stdlib 脚本 / 五阶段 + 门禁类型全表）；**本包未联网抓取、未 npx install、未装宿主目录**（零整包安装证明见契约测试首条 + find/grep 取证：仓库无 `.img2threejs`/`img2threejs/package.json`/`img2threejs/scripts`）。

## 借的形（范式抽取，不复制实现）

| 上游门禁范式（评估 §1.2/§2.1） | 本包受治理落点（spec-gate.mjs） |
|---|---|
| script-enforce + fail-closed（strict gate 失败出 BLOCKED、不写 factory） | `evaluateSpecGate()`：违规 → `{verdict:'BLOCKED', factoryEmitted:false, diagnostics[]}` |
| pass-gated 逐阶段解锁（Stage1-5） | `advanceGate()` + `PASSES=[intake,spec,build,review,rig]`，跳阶/重复拒绝 |
| per-region confidence → evidence | `componentTree[].confidence ∈ [0,1]`，低于 `MIN_CONFIDENCE=0.5` → BLOCKED |
| 外部服务默认关（hosted TRELLIS/Context7/SAM2） | `validateExternalServices()`：未显式 allow-list 即 `allowed=false`，仅显式命中才放行；**模块无任何 transport/网络面** |

不复制：~90 Python 脚本 / doctor / npx install / 宿主 skill 目录 / 品牌文案 / 外部服务实现。

## HK-01 红绿（契约测试，test/block469-img2threejs-shim.test.mjs）

- RED（实现前，spec-gate.mjs 缺席）：tests 1 / fail 1（ERR_MODULE_NOT_FOUND）。
- GREEN（实现后）：tests 7 / pass 7 / fail 0。覆盖：
  1. 零整包安装证明（无上游包/宿主目录/Python requirements）
  2. 合法 spec → pass + factoryEmitted=true
  3. fail-closed（null/缺树/空树/非法 class → BLOCKED 且不写 factory）
  4. per-region confidence 低 → BLOCKED（诊断含 confidence）
  5. pass-gated 按序推进 + 跳阶/重复拒绝
  6. 外部服务默认关 + 显式 allow 才放行
  7. 零依赖/零外部面（无 img2threejs import、无 child_process/https/fetch/torch）

## 边界

零新增产品依赖（纯 JS sidecar）；不碰 agent 内核 / SceneSpec / capability 开合 / W11 Gen UI；
本包无 UI 写面，观感 pending_human_eye 不代签；untracked 用户资产零触碰。
G0 开发期常态 · 不外推 packaged/Provider/GA。
