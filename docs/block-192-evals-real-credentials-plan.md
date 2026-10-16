---
capability: evaluation
goal: BLOCK-192 = 评测基线 v2 provider 切片·real 模式凭据自给 + real 基线棘轮（§5.1 阶段2 出口判据中唯一未落的「真实模型测量」面）。P0 复核纠正：本会话曾据「PETRI_EVALS_PROVIDER_KEY 未设」对外判 provider 切片 blocked，实为**探针不健康误判**——本机凭据库确有 deepseek key（`ai-credentials.json` 值=纯字符串，macOS 走 Keychain/其余走 0600 文件，规范读法在 core/petri-server/helpers/credential-store.js createCredentialStore）。注入该 key 后 `--provider=real` 实测 **3/3 PASS·measures=model**。真实缺口不是「没凭据」，而是**harness real 模式只认 env**：spawnIsolatedBackend 给隔离临时目录自种 credential_updates，故永远看不到桌面端凭据库，每次跑真模型都要手工注 key。本包补该回落 + 给 real 套件建棘轮基线。
acceptance:
  - P1 real 凭据自给：harness 加 `resolveRealProviderSettings()`——env 显式给定则原样用（零行为变更·向后兼容）；env 缺 key 时回落读本机数据目录（PETRI_LOCAL_DATA_DIR 优先，否则 homedir + BRAND.LOCAL_DIR_NAME）：读 ai-settings.json 取 active 预设的 provider/model/baseUrl，用 **createCredentialStore(settingsDir).get(provider)** 取 key（复用单源读取器，不重解文件字段、不自建 keychain 分支），provider→baseUrl 缺省映射显式登记（deepseek→https://api.deepseek.com/v1）
  - P2 诚实降级：回落取不到 key/无预设/未知 provider → 保持既有「诚实 skip」语义并在报告标注原因，**绝不伪造真模型结果**；零明文 key 入日志/入证据文件
  - P3 real 基线棘轮：`evals:gate --suite=real --update` 建 `evals/baselines/real.json`（此后 real 跑受回归棘轮守护），并经 BLOCK-191 formal-admission 双齐门核验准入
  - 门禁：docs:check/ui:audit:check（纯基建免 UI-###）/契约测（回落解析纯函数：env 优先·文件回落·无预设 skip·provider 映射·**不泄漏明文 key**）/real 套件复跑绿/test:changed 全绿
  - 完成语义：`npm run evals:run -- --suite=real --provider=real` 无需手工 env 即跑真模型并绿；real 有基线棘轮；key 明文全程不外泄
reopen: capture/replay **真实录制态**（record 真模型响应入 fixture）显式 defer——本项目有「LLM 原文不入仓」隐私红线（acceptance/block-119 注记），把真模型响应提交进 `evals/` 与「原文只作本地运行产物」的既有纪律冲突，需单独裁决（本地 gitignored 录制目录 or 只入脱敏归一形状），不硬塞
status: completed
---

# BLOCK-192 — real 模式凭据自给 + 入库脱敏 + real 基线棘轮（评测 v2 provider 切片）

- 状态：`completed`（2026-10-16 用户「上」发令 → 单会话闭环；closeout 门禁全绿；**零手工注入实机验收 3/3 PASS·measures=model**）

## 1. 立项自检
证据自证=「质量声明」要能一键在真模型上重放，而不是每次靠人手工塞 key；同时凭据只在内存/受保护存储里流动，绝不进日志与证据文件（本地可审计也要可审计得干净）。

## 2. 范围（P0 复核）
| 面 | 实况 | 处置 |
| --- | --- | --- |
| 凭据 | `ai-credentials.json` 有 deepseek（值=字符串）；macOS=Keychain | 复用 `createCredentialStore().get(provider)` 单源读 |
| 预设 | `ai-settings.json` active_chat_model_id=deepseek-chat，provider=deepseek，**preset 无 baseUrl** | 回落需 provider→baseUrl 缺省表 |
| harness | 只读 `PETRI_EVALS_PROVIDER_KEY` env；隔离 temp 自种凭据 | 加 env→本机库两级解析；env 在则行为不变 |
| 基线 | `evals/baselines/` 只有 smoke/golden，real 无 | `--update` 建 real 基线 |

## 3. 非范围（红线）
- **不伪造 real 结果**：解析不出凭据即沿用诚实 skip + 报告标因。
- **不外泄 key 明文**：不进日志/证据/stdout；契约测断言输出零 key 子串。
- **不改 mock 模式行为**：`--provider=mock` 路径与既有 32 项套件判据零变更（防回归）。
- **不录真模型原文入仓**：capture record 侧见 reopen（隐私红线待裁决）。
- **G1+ 不外推**：不碰 packaged/Provider 商务面/公证。

## 4. 执行
P1 `resolveRealProviderSettings()` 纯解析 + IO 薄壳（harness）→ P2 诚实 skip 归因 → P3 real 基线棘轮 + 191 准入门复核 → 契约测 + 真跑复验 → P4 closeout+五件套。

## 5. 并行隔离
触碰面=`scripts/lib/evals-harness.mjs`（解析回落）/`scripts/evals-run.mjs`（real 分支接回落）/新 `test/block192-*.test.mjs`/`evals/baselines/real.json`（新基线）/impact-map。真模型调用只在验收复验时发生，零 dev 栈依赖、零人眼。
