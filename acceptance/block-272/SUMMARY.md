# BLOCK-272 收口证据摘要（closeout 收口定向化）

收口日期：2026-10-27 · HEAD 基线 0fab977b · 全部证据本目录。

## 1. 计时对照（单项计时探针 scripts/block272-timing-probe.mjs）

| 项 | before（冷） | after（冷） | after（热） |
| --- | --- | --- | --- |
| quality:lint | 79s | ~82s（含缓存首建） | **1.5s** |
| quality:types | 12.1s | 12.3s | **1.6s** |
| gate:arch-cycles | 2.2s | 2.2s | 2.2s（同轮首次 cruise） |
| quality:arch | 1.8s | 1.8s | **0.4s（同轮缓存命中）** |
| quality:knip:check | 3.3s | 3.2s | 3.3s |
| **合计** | **98.4s** | 101.3s | **10.4s** |

文件：timing-before.json / timing-after-cold.json / timing-after.json。热态=增量提交稳态（lint/tsc 缓存 + cruise 同轮共享）；域跳过在此之上再省 arch/knip（docs/治理类提交）。

## 2. 红绿先行（HK-01）

- 红：test/closeout-gate-skip.test.mjs + test/quality-arch-wrapper.test.mjs 在实现缺失时整文件失败（module not found）。
- 绿：13/13（decideSkip 八例矩阵 + 包装器 spawn 干净仓/同轮缓存命中/evaluateArchRules 红/绿/职责隔离）。

## 3. 回归

31/31 全绿（test-affected.test.mjs 18 例 + block109-p3-gates + dev-verify + platform-branch-freeze + knip-ratchet；总 1058s，其中「vitest 通道防复发」用例 864s=59 探针×全量 validateMap 串行，慢而有限如实记录）。

## 4. closeout 实机

- **targeted closeout（十三门）**：exit=0 全绿（task slot 20261027-061806-block272-closeout-soqf6）。域自纠实证：arch 两门「域内命中（scripts/arch-cycles-gate.mjs, scripts/lib/arch-cruise.mjs）→全量执行」（本批改了门禁实现，必须重跑）；quality:arch 0.4s=同轮 cruise 缓存命中；tests 门 704s。
- **closeout:full（--force-full 全量转义）**：exit=0 全绿、header 标注 force-full、零域跳过行（task slot 20261027-063309-block272-closeout-full-ph28t）。
- **域跳过实证**：live-skip-evidence.txt 三轮实录——一/二轮（WIP 语境）域内命中→全量（fail-open 判定链实证；本摘要原「次轮 arch 两门 SKIP」注记失实，评审抓真改写）；第三轮（提交 d6118ee7 后干净树两连跑）**三门 SKIP 带锚点短 sha=真 SKIP 实证**（SKIP 不刷新锚点）。

## 5. Jev 决策建议实录（supply=cloud）

- test:suggest（conf 0.95）：追加 dev-verify + platform-branch-freeze 两测试入定向集——**platform-freeze 抓真**：探针的 process.platform 分支（含注释字面量）违反 BLOCK-104 冻结门，改 shell:true 跨平台 spawn 后复绿。
- doc:suggest：planDoc 0.89 采纳（本收口记录）；uiAudit 0.06 零建议（本包无 UI 增量，正确）；auditLog 模型 0.66 零建议但台账回写是治理下限（红线①），照常回写。

## 6. 抓真与自纠

1. test-affected 18 红 = 5 个新脚本未登记 impact-map（"恰好一规则"断言）→ 登记 block272-closeout-targeted 后复绿。
2. platform-freeze 门禁为文本扫描，注释中的字面量也命中 → 探针注释改写（并保留 shell:true 收敛）。
3. **域设计自纠**：门禁自身实现脚本原本不在其域内（改门禁代码可被域跳过）→ GATE_DOMAINS 将实现脚本纳入域（closeout-gates.mjs 注释留痕），本批 closeout 即按此全量重跑两道 arch 门。

## 7. 范围守住

test:changed 语义/并发未动；knip/arch 判定规则与基线未动（arch 基线仍 14 环在册）；`npm run check` 发布链不引用 quality:lint/types（已核实），完全未动。G0 开发期常态 · 不外推 packaged/Provider/GA。
