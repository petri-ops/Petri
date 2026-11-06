# NSO Wave-7a 证据目录（BLOCK-362 · 2026-11-06）

| 项 | 契约 | 红→绿 | 实战证据 |
| --- | --- | --- | --- |
| audit:compact 脏目标守卫 | `test/nso-w7-governance-tooling.test.mjs` | 5/5 红 → 5/5 绿 | `closeout-current-tree.log`：检测到 `audit-log-through-2026-11-05.md` 带未提交改动 → 改写 `audit-log-through-2026-11-05.r20261106T034014Z.md`；在制集文件 diffstat 前后均为 +9（首次无需人工迁回） |
| coverage 计数校验 + `npm run docs:coverage` | 同上 | 同上 | 真实注册表 documentCount→1：`COVERAGE_COUNT_DRIFT` 判红；恢复后 PASS；重算 494/477 |

closeout 当前树 test:changed 门 FAIL，红项与 W2/W4 同一归因集合（在制批 model-surface/P6、C-46 p4r、并发写入者 UI 台账 BLOCK-332、存量 NEXT-03），无新增。

Jev（cloud 未降级）：doc:suggest uiAudit+planDoc（W7a 无 UI 面）；output:judge 首轮 RETRY（fit 2.95：未正面回答「是否成立」）→ 带判词重答 PASS（fit 3.62）；next:suggest NSO-W6（0.20）。
