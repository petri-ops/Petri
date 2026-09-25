# CK-05 评估报告：node:sqlite 迁移 / 三契约单源化 / mmap_size 裁决

> truthDomain: sqlite-evaluation · 状态：评估完成（mmap 已实施；node:sqlite 与三契约单源化=不建议现在做）
> 来源：BLOCK-109 plan §2 候选池登记 + block-106 plan §7 mmap 遗留。实验证据：OS temp bench 脚本两轮（数据见 §2，脚本不复制入仓——一次性装置）。
> archivePolicy: retain_stable_path（评估报告长期留档，实施项 mmap 已落 connection.js）
> canonical 入口：docs/README.md §评估与专项
> 结论先行：**mmap_size=64MB 已实施**（`core/biof3-server/db/connection.js`，per-connection pragma）；**node:sqlite 迁移不采纳**；**三契约单源化不采纳**（既有机械守护已覆盖其收益）。

## 1. 勘察现状

| 面 | 现状 |
| --- | --- |
| SQLite 引擎 | better-sqlite3 12.11.1（native 模块）；core 侧 `db/connection.js` 单点封装（WAL + busy_timeout 10s + wal_autocheckpoint），另有 db.js / agent-task-store / process-lifecycle / site-snapshot / retention-sweeper / src/main.js 各自开库 |
| node:sqlite | Node 24 内置可用（`DatabaseSync`）；**已在测试装置使用**（block107-timeline-long flow 直插种子） |
| mmap_size | 未设置（默认 0=禁用）——block-106 实验曾测得特定大扫描 2.2x 收益，遗留裁决 |
| 三契约 | `src/preload.js`(566 行) / `frontend/src/lib/desktopBridge.ts`(137 行) / `frontend/src/lib/electron.d.ts`(864 行)，人工同步；**已有机械守护** `test/ipc-channels-registry.test.mjs` 双向漂移门禁 |

## 2. 基准实验（dev 库副本 ×3 配置，两轮稳定）

| 配置 | 点查×1000 | 范围扫描×50 | 大扫描(task_events 全表)×10 | 批量插入×1000 |
| --- | --- | --- | --- | --- |
| better-sqlite3 默认 | 17.9 / 19.7ms | 1.4ms | 3499.6 / 3492.4ms | 4.8 / 3.6ms |
| better-sqlite3 + mmap64 | **15.3 / 15.2ms** | 1.2 / 1.3ms | **3179.9 / 3208.4ms** | 2.0 / 2.6ms |
| node:sqlite + mmap64 | 15.3 / 15.8ms | 1.3ms | 3398.2 / 3377.9ms | 10.1 / 4.6ms |

结论：
- **mmap64**：大扫描 −8.5%、点查 −15%，两轮稳定；零风险 per-connection pragma，WAL 兼容。与 block-106 时代「2.2x」的差距=当时口径是特定全表清扫（SCAN→SEARCH 索引优化前后）语境，当前库规模与索引形态下收益温和但真实。
- **node:sqlite vs better-sqlite3（同 mmap64）**：点查/范围扫描同级；大扫描 +5%；**批量插入慢 ~1.8x**（node:sqlite 的事务封装/statement 开销）；无内存/稳定性优势观测。

## 3. 三题裁决

### 3.1 mmap_size=64MB → **采纳（已实施）**
`connection.js` 打开点设置 `mmap_size = 67108864`（per-connection，每次打开生效）。实施即完成，无迁移面。

### 3.2 node:sqlite 迁移 → **不采纳（维持 better-sqlite3）**
- 性能：无优势（大扫描 +5%、插入慢 1.8x）。
- API 差异面：`db.pragma()` → exec、`db.transaction()` helper 缺失（手动 BEGIN/COMMIT）、迭代器/类型行为差异——使用面 8 文件，迁移+回归成本实打实。
- 唯一真实收益=去 native 依赖（免 electron rebuild 摩擦）；better-sqlite3 12.x 现状稳定，该收益不足以覆盖迁移风险。
- **重开条件**：better-sqlite3 升级断供 / Electron 内置 node:sqlite 版本对齐上游带来实质性能修复 / native rebuild 在新平台成为持续摩擦点。

### 3.3 三契约单源化 → **不采纳（维持人工同步 + 既有门禁）**
- 收益重估：三份契约的漂移风险已被 `ipc-channels-registry.test.mjs` 双向守护机械化（漂移即红），单源化的增量收益=减少人工同步成本，非正确性收益。
- 成本：electron.d.ts 864 行结构复杂，schema→三份 code-gen 工程量大且引入生成器自身维护负担。
- **重开条件**：IPC 通道规模翻倍或三契约再出一次守护门禁漏掉的漂移事故。
