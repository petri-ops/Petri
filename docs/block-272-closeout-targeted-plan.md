---
capability: block-272-closeout-targeted
goal: closeout 收口定向化——常规提交收口从「全量重扫」降为「增量+域跳过+同轮去重」，每道门保持 fail-closed 语义不变。用户裁决（2026-10-27）原话：「我觉得 需要缩短，如果不进行版本发布其实不需要做 全量的check对吧？ 每次优化升级只是部分代码，收口只需要校验有改动的部分即可。你看看怎么处理」。
acceptance:
  - 门禁语义不变（fail-closed）：eslint 缓存/tds 增量由工具内建保证正确性；域跳过=改动域与门禁域不相交才 SKIP（状态缺失/损坏/锚点不可达一律 fail-open 回全量）；cruise 同轮去重=同一次收口内两门共享一份 JSON。
  - 红绿测试：decideSkip 七例（无状态/损坏/锚点非祖先/域不相交/域相交/配置漂移/force-full）+ quality-arch 包装器（干净仓 spawn exit 0 / 同轮缓存命中 / evaluateArchRules 红/绿样本）。
  - 计时对照：四项重量门禁单项计时 before/after 落 acceptance/block-272/（before=eslint 79s/types 12.1s/cruise 2.2+1.8s/knip 3.3s，总 98.4s）。
  - 转义实测：`npm run closeout:full`（--force-full）全量跑通一轮；域跳过实测输出带理由与锚点 sha。
  - impact-map 登记 block272 规则 + routing 验证；closeout 十三门 PASS；AGENTS/SKILL 门禁行同步。
reopen: 依赖图增量 cruise（depcruise 无内建增量，域跳过已覆盖其主要收益）；test:changed 内部并发化（BLOCK-97 稳定性史，另立项）；test-affected「vitest 通道防复发」用例 864s 优化（59 探针×全量 validateMap 串行，慢而有限）。
status: completed
---

# BLOCK-272 · closeout 收口定向化（开发基础设施）

## 1. 问题与量化（实测 before，HEAD=0fab977b）

用户痛点：每次收口耗时长。单项计时（`scripts/block272-timing-probe.mjs`，acceptance/block-272/timing-before.json）修正了直觉：

| 门禁 | before |
| --- | --- |
| quality:lint（`eslint .` 无缓存） | **79s（占 80%）** |
| quality:types（tsc 全程序） | 12.1s |
| gate:arch-cycles + quality:arch（同三棵树 cruise 两遍） | 2.2s + 1.8s |
| quality:knip:check | 3.3s |

即重量静态门约 98s/轮；test:changed 另计（代码类工作包的主变量，本轮不动——BLOCK-97 稳定性史）。

## 2. 方案：三层机制（每道门 fail-closed 语义不变）

1. **工具内建增量**（正确性由工具保证）：quality:lint 加 `--cache --cache-location node_modules/.cache/petri-eslint/.eslintcache --cache-strategy content`；quality:types 加 `--incremental --tsBuildInfoFile node_modules/.cache/petri-tsc/tsbuildinfo`（node_modules 已 gitignore）。
2. **域跳过**：改动域与门禁域不相交 → SKIP-with-reason（复用 closeout-gates 既有 SKIP 语义）。适用 arch 两门 + knip。判定链：状态在且合法 → `merge-base --is-ancestor` 锚点可达 → 改动域不相交 → 配置/基线 digest 未变；任一不满足即全量。SKIP 不刷新锚点（防漂移），PASS 且实际全量跑过才更新 `verifiedCommit`。状态文件 `.petri-dev-user-data/closeout-gate-state.json`（gitignored，仿 dev-launch-state.js 模式）。
3. **同轮去重**：gate:arch-cycles 与 quality:arch 共享一份 cruise JSON（`scripts/lib/arch-cruise.mjs`：R1-R5 + P3-no-cycles 合并配置一次 cruise；缓存 `node_modules/.cache/petri-closeout/`，以 `PETRI_CLOSEOUT_RUN_ID`（聚合器注入）+HEAD+status 戳判新鲜，**跨轮不复用**——untracked 文件内容变更对 status 不可见，跨轮复用不健全）。

安全护栏：`--force-full` 旁路全部跳过/缓存；`npm run closeout:full` = `npm run closeout -- --force-full`（发布/CI 用）；`npm run check` 链路**完全不动**。closeout-gates 位置无关性保持：host 脚本（test-affected/gate-skip-state）缺失时域跳过特性自动关闭、门禁照常全量（fail-open，同 repoGate 先例）。

## 3. 改动面

| 文件 | 动作 |
| --- | --- |
| `scripts/lib/changed-files.mjs` | 新：提取 test-affected.mjs 的 `collectChangedFiles`/`runGit`/`normalizePath`（行为不变，test-affected 改 import） |
| `scripts/lib/gate-skip-state.mjs` | 新：状态读写 + `decideSkip`（可注入 statePath 供测试） |
| `scripts/lib/arch-cruise.mjs` | 新：合并 cruise + 同轮缓存；导出 runSharedCruise() |
| `scripts/arch-cycles-gate.mjs` | 改：cruise 走共享 lib（extractCycleSignatures/computeGate 契约不变） |
| `scripts/quality-arch.mjs` | 新：quality:arch 包装器——消费共享 cruise 评 R1-R5，退出码语义与裸 depcruise 一致（导出 evaluateArchRules） |
| `.agents/skills/petri-dev-infra/scripts/closeout-gates.mjs` | 改：`--force-full`；门注册加 domain 元数据（arch 两门+knip）；启动注入运行 ID；动态 import host lib（缺失→特性关闭） |
| `package.json` | quality:lint/types/arch 三行改写 + `closeout:full` 接线 |
| `test/closeout-gate-skip.test.mjs` / `test/quality-arch-wrapper.test.mjs` | 新（红绿先行） |
| `test/impact-map.json` | 登记 block272-closeout-targeted 规则 |

非范围（红线）：test:changed 内部语义与并发度不动；knip/arch 判定规则与基线不动；`npm run check`/发布链不动；G1+（Provider/公证/GA）不涉及。

## 4. 断言面与阶段

- 断言面：decideSkip 七例（判定矩阵）＋包装器（spawn 干净仓 PASS / 同轮缓存命中标记 / evaluateArchRules 红绿样本）＋现有 routing（test-affected.test.mjs 不回归）。
- 阶段：P1 立项登记（本批）→ P2 红绿测试先行 → P3 实现 → P4 计时对照+转义实测 → P5 closeout+台账回写。预期一次会话收口。
- Jev 实录：test:suggest（supply=cloud）建议追加 `test/dev-verify.test.mjs` + `test/platform-branch-freeze.test.mjs`（infra-platform 域，conf 0.95）——纳入收口定向集，增量附加不替代 impact-map 下限。

## 5. 收口预期预先声明（启动检查单 §3）

验收门禁清单：①红绿测试两文件全绿（先红后绿证据留档）；②test:changed routing 验证（unknown=0）；③计时 after 落盘+对照表；④closeout:full 全绿一轮；⑤closeout 十三门 PASS（定向语义生效）；⑥docs:check/ui:audit:check 必跑。无 UI 台账增量（纯治理门禁，对标 block-154 先例）。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 收口记录（2026-10-27，P4-CLOSED）

- **红绿**：13/13（decideSkip 八例 + 包装器五例；红=实现缺失两文件失败，绿=全过）。**回归 31/31**（test-affected 18 + block109 + dev-verify + platform-freeze + knip-ratchet；vitest 通道防复发用例 864s 慢而有限如实记录，优化入 reopen）。
- **计时**（acceptance/block-272/timing-*.json）：静态门冷 98.4→101.3s（缓存首建 +3s），**热 98.4→10.4s**（lint 79→1.5s、tsc 12.1→1.6s、quality:arch 1.8→0.4s 同轮缓存命中）。
- **closeout 实机**：十三门 PASS exit=0——域自纠实证（arch 两门因实现脚本改动「域内命中→全量」）、quality:arch 0.4s 同轮共享；**closeout:full** PASS exit=0 零域跳过行（force-full 转义实证）；域跳过实证=live-skip-evidence.txt 三轮实录：一/二轮（WIP 语境）域内命中→全量（fail-open 判定链实证；原「次轮 arch 两门 SKIP」注记系证据标题失实，评审抓真改写）；第三轮=批次落定 d6118ee7 后干净树两连跑，**三门 SKIP 带锚点短 sha（真 SKIP 实证，SKIP 不刷新锚点）**。
- **抓真三处**：①test-affected 18 红=新脚本未登记 impact-map（登记 block272-closeout-targeted 复绿）；②platform-freeze 抓真=探针 process.platform（含注释字面量）违 BLOCK-104 冻结门→shell:true 收敛（Jev test:suggest 追加建议直接命中）；③域设计自纠=门禁实现脚本纳入自身域。Jev 实录=doc:suggest planDoc 0.89 采纳/uiAudit 0.06 零/auditLog 纪律下限回写。
- 证据：acceptance/block-272/（SUMMARY.md + timing 三件 + live-skip-evidence.txt）。收口运行=task slot 20261027-061806（targeted）/20261027-063309（full），以退出码为准（0/0）。
