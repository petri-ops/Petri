# G1 就绪度评估材料（2026-11-24 · 只评估不开工）

> **勘误注记（2026-11-25 · W3 核真，owner 裁决 msg_d8df1b1e636f）**：本材料 §一.1「既有 Git consent UI（五条独立 task trace）」所述「后端已有 opt-in、缺前端同意 UI」**已失效**——canonical **UI-462（2026-10-03 owner 裁决、10-30 verified）整体退役「接入用户自有 Git 仓库」能力**，consent UI/2 端点/存储/schema 全拆，`bindProjectRepository` 收敛 managed-only；UI-127 台账明确「P7 existing Git consent UI 项随之失效」。核真三证：`git-repository-binding.js:10` managed-only 声明、`result-studio-repository.js:222` consent 表保留但不再读写、`existing_repository_not_attached_without_consent` 在 core 生产代码零命中。本 G1-READINESS 旧表述仅为当时盘点快照，不描述现行产品；后续以 UI-462 为准，详见 `acceptance/g1-rs-requalification/W3-SCOPE-NOTE.md`。资格矩阵残留（REQUIRED_ENVIRONMENTS existing_* + evidence-bundle existing 分支）单列「P7 资格契约与 UI-462 对齐」子包待裁决，未批前不擅动。

> 授权：owner 经 Orca 转达「下一波两件」第二项——功能面收干净后（Q-MATRIX ✅95·🟡0·🔴0·⛔7）的 G0→G1 门槛盘点与建议顺序。性质=方向性拍板材料，非排产、不启动任何 G1 工作。
> 数据源全部现读：AGENTS.md 当前阶段纪律、`docs/g0-result-studio-plan.md` §14、AUDIT-LOG D-01/D-03/D-05/backlog 行、`docs/dependency-decoupling-checkpoint.md`、RULING-TABLE-2026-11-24。G0 长期开发期纪律不变——本材料不构成进入 G1 的决定。

## 一、三大块差距盘点

### 1. Result Studio 重资格（D-01，L）

现状=`implemented_unverified / experimental`；`qualificationEligible:false` 是 G0 常态非缺陷。重资格差（g0-result-studio-plan §14 / BLOCK-503 判据）：
- selection→enrichment 无 candidate/compare/lifecycle 三链；
- 既有 Git consent UI（五条独立 task trace）；
- 双 Provider 矩阵真实跑通；
- packaged 六格与 literal OS reboot 实机；
- 历史 RS9/P4R/P6 证据不得冒充资格（诚实边界已内建）。
体量=L（多包+真机+双 provider 成本）。前置=进入 G1+ 决策本身。

### 2. 打包/签名/分发（D-03/D-05，M~L）

- Windows 代码签名：`electron-builder.yml` win 段无证书/签名配置，现装包为未签名 NSIS；**阻塞于 EV/标准证书到位（外部依赖）**，到位前 `windows-x64.supported` 维持 false 不得翻转。
- macOS 公证/签名：G1+ 阶段事项（G0 不校验）。
- OSS 远程接手/商店面：D-05 平台项（E7 macOS 构建、L4 sidecar、K4 OS 通知历史、D1 低峰计价）等外部真值。
- dist staleness / release-pipeline：G1+ 流水。
体量=签名 M（证书到位后）/分发流水 L。前置=证书（外部）+ G1 决策。

### 3. G0→G1 门槛清单（建议顺序）

| 序 | 门槛 | 性质 | 现状 |
|---|---|---|---|
| 1 | 功能面收口维持（Q-MATRIX 🟡0/🔴0） | 已达标 | ✅95/0/0（持续维护即可） |
| 2 | 裁决表批量拍板（agent 唤醒 B 已落地；C-43 已清偿；其余暂不做带重开条件） | 已备材料 | 等主人一句话 |
| 3 | 用户实测样本（E-03 类真人走查/SUS 问卷投放） | 半外部 | 问卷已备（BLOCK-503），等投放渠道 |
| 4 | RS 重资格 P0–P4 差距补齐（§一.1） | G1+ 首包 | 未启动（诚实红维持） |
| 5 | 代码签名证书（Win）+ 公证（macOS） | 外部 | 等证书 |
| 6 | 打包六格+真机重启+发布流水 | G1+ | 未启动 |

**建议顺序**：2（零成本拍板）→ 3（真人样本投放）→ 4（RS 差距补齐，G1 首包）→ 5→6（外部到位后）。1 持续维持。

## 二、如实边界

- 本材料不改变 `qualificationEligible:false` 与 G0 常态纪律；任何 G1 启动须主人显式裁决（AGENTS.md 阶段纪律）。
- 外部真值项（证书/硬件/隧道/电价）不催不动，到位即解锁对应门槛。
- RS 历史证据（RS9/P4R/P6/block-334 等）不得在 G1 材料中冒充资格证据（既有裁决重申）。

## 三、拍板口令

- 「进 G1」= 启动 §一.3 序列 4（RS 差距补齐首包）；「先等」= 维持 G0 常态、序列 2/3 择机推进；也可逐门槛口令。
