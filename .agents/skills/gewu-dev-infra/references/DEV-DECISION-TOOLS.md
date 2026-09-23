# DEV-DECISION-TOOLS — 开发时决策建议工具（BLOCK-118）

> Jev/Laya 决策原语的开发流程接线：`npm run test:suggest`（增量测试域建议）与
> `npm run doc:suggest`（文档回写建议）。两者都是**建议器**——增量附加、只加不减、
> 低置信/降级=零建议；任何分支都不可能减少静态门禁（impact-map 下限/收口链）的既有语义。

## 何时用

| 时点 | 命令 | 作用 |
| --- | --- | --- |
| 规划定向测试前 | `npm run test:suggest` | 在静态 impact-map 下限之上，由决策模型分类改动波及的测试域，**追加**建议补跑的定向测试 |
| 工作包增量完成、准备台账回写前 | `npm run doc:suggest -- --context "<改动说明>"` | 提示可能漏回写的 canonical 文档（planDoc 为模型门控；frontend/src 变更的 uiAudit 为确定性硬命中） |

## 供给选择（`--supply`）

- `--supply=file`（默认）：跟随 `data/decision-config.json`（设置页「决策模型接口」同源，
  当前可为本机 Laya 8765 或 Jev 云）。
- `--supply=cloud`：从 `.biof3-dev-user-data/jev.env.bak-by-user-request` 读 key 直连 Jev 云
  （只读不回显；当前唯一有完整校准证据的供给）。

**双供给校准事实（2026-09-23，证据 `acceptance/block-118/`）**：

- test-suggest：Jev 云可用（θ=0.8）；**Laya 不可采纳**（confidence/top-probability 双语义
  均不过门）——Laya 供给下恒零建议（安全默认，非故障）。
- doc-suggest：仅 planDoc 有模型门控（Jev θ=0.5，精度 0.82/覆盖 0.87）；uiAudit=确定性硬规则
  （`frontend/src/**` → 必建议）；roadmap/handoff/auditLog 双供给均不可采纳 → 静默
  （回写检查仍由收口纪律承载，本工具不假装能预测）。

## 如何解读输出

- `建议追加测试域「agent-backend」（N 个测试，conf=… ≥ θ=…）`：追加执行建议清单里的
  定向测试（`node --test <files>` / `npm run test:files --prefix frontend -- <files>`）。
- `零建议（below_threshold，model=…）`：模型置信不足，**不是工具故障**；静态下限照常执行。
- doc:suggest 的 `--context` 强烈建议提供（改动说明一句话）：回写意图主要在语境里，
  无 context 时 planDoc 判别力显著下降（校准三轮 D-修订的证据教训）。
- 两个工具的调用都会落 `decision_log` 台账（BLOCK-116 观测面可见），供给切换在
  设置页「决策原语→模型接口」或 `--supply` 每次显式指定。

## 红线

1. 建议永远只附加：不许因「零建议」跳过 impact-map 下限、收口门禁或台账回写纪律。
2. 阈值与门控证据绑定（`helpers/decision-thresholds.js` 注册表）：改 θ 必先重校准
   （block116 契约测试机械承载）；「Laya 不可采纳」结论翻转同样需要新校准证据。
3. 校准/运行 cloud 供给时 key 只读 `.biof3-dev-user-data/`（gitignored），不回显不入仓。
4. 语料与校准脚本改动 = 接点证据失效，须重跑校准并同步注册表（`scripts/block118-*-calibrate.mjs`）。
