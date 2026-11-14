# BLOCK-446 凭据 file 后端加密化 + 错误语义分离

- status: completed
- phase: COMPLETED
- owner: 主 Agent（ZCode 会话）
- created: 2026-11-14
- source: 对标仓库 reference/ZCode v3.18.2 借鉴项（systemCredentialCipher 范式）落地

## 0. 用户裁决留痕

用户裁决（2026-11-14）原话：「好的 按照你的建议来」——针对 Jev 单一建议「**凭据 file 后端加密化 + 错误语义分离（补安全缺口）**」（confidence 中高，主战场 `core/petri-server/helpers/credential-store.js`）。本包即该建议的落地。

## 1. 立项自检问句（产品个性纪律 · 必答）

「这个能力的形态与 ZCode/Codex 的差别在哪？本地可审计 / 治理透明 / 证据自证体现了吗？」

- **本地主权形态**：密钥永不离开本机——macOS 走 Keychain，其余平台走本机 AES-256-GCM 文件密钥（`$PETRI_LOCAL_DATA_DIR/keys/mcp-env.key` 单源复用）；零厂商中继、零云端托管（ZCode 凭据面含其云端 Start Plan 账号链路，Petri 无此面，此为差异本体）。
- **治理透明**：三类存储状态（干净空态 / 存储错误态 / 值不可解态）诚实区分可查（`status()` 健康面 + warn），损坏文件 **fail-closed 拒覆写**——不静默把「存储坏了」伪装成「未配置」，不静默销毁其他 provider 条目。
- **证据自证**：红绿先行（先写「落盘零明文」断言红→实现转绿），测试直接读盘验证密文形态，不依赖实现声明。

## 2. 范围（in scope）

1. **file 后端落盘零明文**：`set()` 写入值改为 `enc:v1:<iv>.<tag>.<cipher>`（复用 `mcp-env-crypto.js` 的 `encryptSecret`，加密单源不另起炉灶）；`get()` 经 `decryptSecret` 解密读取。
2. **存量迁移**：读取时明文透传（与 mcp-env-crypto 同语义）；get 命中文件内任一明文值时**整组急切迁移**（全值加密重写，原子 rename；迁移失败 fail-open——仅 warn，本次调用值仍可用，绝不因迁移失败丢值）。
3. **错误语义分离**（`readFileStore` 现状 `catch → {}` 把一切错误压平成「未配置」，即本包要拆的混淆）：
   - 文件不存在 = 干净空态（`{}`，无 warn）；
   - 文件不可读/JSON 损坏 = 存储错误态：`get()` → `''` + warn 不崩；`set()` → **fail-closed 抛错拒覆写**（防「损坏文件 + set(newProvider) → 整文件被单条目覆盖 → 其他 provider 密文全毁」的真实破坏路径）；`remove()` → 无操作不崩（文件零触碰）；
   - 值不可解（密钥丢失/密文损坏）= 该 provider 不可解态：`get()` → `''` + warn；密文串保留在盘，其他条目写时原样保留（不丢弃）。
4. **`status()` 只读健康面**：返回 `{ backend, filePath, fileExists, ok, error }`（error ∈ `null | 'unreadable' | 'corrupt'`），供诊断与测试断言三态。
5. **测试**：新建 `test/block446-credential-file-encryption.test.mjs`（红绿先行）；`test/impact-map.json` 的 `block405-l1-security-hardening` 规则挂载新测试（新测试不挂规则即红的棘轮纪律）。

## 3. 非范围（exclusions · 登记不外推）

- macOS keychain 后端零改动（已达标：stdin 传值 + 双提示写法为 BLOCK-405/L1-6 成果）。
- Windows Credential Manager / Linux Secret Service 原生接入与 `@napi-rs/keyring` 类原生依赖——G1+ 发布期事项（ZCode plan 亦标注未实机验收），本包不做。
- `mcp-env-crypto.js` 密钥文件的硬链接排他发布（ZCode credential-secret 发布范式）——备忘，属密钥文件硬化，另行立项。
- key 轮换/重加密工具、密钥指纹（`enc:v2` 的 `<fingerprint>` 段）——备忘，当前单密钥文件形态无轮换面。
- `ai-settings:get-credential` 明文回传 renderer 的 IPC 最小化——独立候选包，不混入。
- mcp-settings.js / ai-memory.js 在他方 WIP 中——零触碰。

## 4. 依赖

- `core/petri-server/helpers/mcp-env-crypto.js`（BLOCK-160 单源，**只 require 不修改**）：`encryptSecret` / `decryptSecret` / 密钥文件位置（`PETRI_LOCAL_DATA_DIR/keys/mcp-env.key`）。
- 消费方 `helpers/ai-settings.js`（迁移循环调 `set()`、`getApiKey` 调 `get()`）——签名不变：`get` 仍返回字符串、`set` 仍返回 true/false 或抛（新增仅「损坏拒写」抛错路径）、`remove`/`isConfigured`/`backend`/`filePath` 不变；新增 `status()` 纯增量。

## 5. patch / refactor 判定

**Patch**（非 refactor）：在既有 `credential-store` 结构内加加密与错误分态，无第二变体概念（加密原语复用既有单源 mcp-env-crypto），不绕过任何既有抽象。`readFileStore` 的 `catch → {}` 由「压平返回值」改为「返回值 + 错误态二元组」属结构内修正，非新概念。

## 6. 验收门禁（收口逐项对账）

| # | 门禁 | 预期 |
|---|------|------|
| G1 | `node --test test/block446-credential-file-encryption.test.mjs` | 全绿；含「落盘零明文」机械断言（直接读盘验证无明文子串、值形态 `enc:v1:`） |
| G2 | 红绿先行留痕 | 新测试先在未实现态跑红（断言落盘密文 → 现状明文即红），实现后转绿 |
| G3 | `node --test test/credential-store.test.mjs test/block150-explicit-credentials.test.mjs test/block405-l1-security.test.mjs test/block414-backend-port-reuse.test.mjs test/platform-branch-freeze.test.mjs` | 既有凭据/安全契约全绿（明文透传迁移语义兼容 block150 明文夹具） |
| G4 | `npm run test:changed:list` | 影响范围可复现，无未知生产路径 fail-closed |
| G5 | `npm run docs:check` + `npm run ui:audit:check` | PASS（治理门禁硬要求） |
| G6 | `npm run quality:secret` + `npm run quality:arch` | PASS |
| G7 | 改动文件 lint 0 error（quality:lint） | PASS |
| G8 | closeout 十一门 | 如实取证（已知 W 类两红为他方在制 WIP，非本包引入，照 BLOCK-435 先例如实登记） |

## 7. 证据位置

- `acceptance/block-446/`（测试输出 / 门禁取证 JSON）
- 台账回写：`docs/next-steps-roadmap.md` 头部 + `docs/AUDIT-LOG.md`（启动登记 + 收口条目）

## 8. 完成语义

- `completed`：G1–G7 全绿 + G8 如实取证（W 类他方红归属注记）+ 台账三件回写 + 提交。
- 本包不宣称「全量通过」：定向范围 = impact-map 影响面 + G3 列名契约；未验证范围在收口报告如实列明。

## 9. 环境纪律

- 已知他方 WIP：172 文件（frontend UI 面 + `core/petri-server/helpers/mcp-settings.js` + `core/petri-server/routes/ai-memory.js` + docs 矩阵文档）——**零触碰**；提交仅 stage 本包列名文件。
- 后端为纯 helper 改动，无 dev 栈依赖；测试全部 node --test 直跑。
- Jev：test:suggest 已跑（cloud 不可用 `http_error`，零建议如实登记，静态 impact-map 下限不受影响）。
