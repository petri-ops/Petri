# M0（BLOCK-426）六维度评审 · 收口前自评

> 按 `$petri-code-review` 七维度（本项目惯称六维度）逐项过；评审对象 = 本包全部自有改动。
> 顺序：先读意图（plan §范围）→ 先看测试（11 项 HK-01 负测）→ 再过实现。
> AI 跑查（ocr）：**本轮未做**（可选外部工具，未装/未配置；不阻塞，按 skill 降级如实声明）。

## 结论先行

**净改善 = 批准收口（带如实登记的 W 类红）**。无 P1；P2 一条（见下），Minor 一条。
关键证据：`closeout` 当次 **exit 1**（第 5 门 `test:changed` 拦停，3 fail 中 2 条 W 归属、1 条本包引入已修），
前 4 门 PASS，后续 13 门 fail-fast 未执行；不写「全绿 / verified / 通过」。

## 逐维度

| 维度 | 结论 | 证据（file:line → 合同原文） |
| --- | --- | --- |
| 1 契约一致性 | PASS | `scripts/m-blueprint-m0-criteria.mjs:181` `collectMeasured` 现取 `package.json:scripts.closeout` 的 `--gate` 计数、`DOC-REGISTRY.json:documents.length`、`impact-map.json:rules.length`；`docs/DOC-REGISTRY.json:12-14` coverage 571/554 与 `docs:check` 实算一致。front-matter 4 键合规（去掉 `kind`/`phase` 未知键），`docs:check` PASS。 |
| 2 单一真相 | PASS（一处待办见 P2） | 数字口径新建 1 份 `m0-canonical-readings.json`，与既有 `scripts/post-k7-readings-generate.mjs` / `scripts/lib/post-h9-k0-readings.mjs` 职责不重叠（历史生成器管历史读数，本包只记当次门禁读数）。`summarizeGapLedgers` 只读 4 套原文、零搬移零改写。未新建第二套 executor/状态机/项目状态。 |
| 3 失败语义 | PASS | `reconcileReadings` 漂移即红；`adjudicateBlueprintStatus` stale 即红；`summarizeGapLedgers` 缺 owner / in_progress 即红；`comparePerf` 慢样本必红；`adjudicateBaselineBinding` sha 漂移 fail-closed。无空 catch 新增。 |
| 4 测试有效性 | PASS | `test/m0-criteria-calibration.test.mjs` 7 项 + `test/m0-criteria-boundaries.test.mjs` 4 项，均测纯函数行为而非字符串扫描；HK-01 实测红→绿两轮（首跑 `ERR_MODULE_NOT_FOUND` 1 failed → 实现缺陷 `true !== false` 1 failed → 修后 11/11 绿）。`W5a` 门抓真「新测试未挂 rule」，已补后隔离 14/14 绿。 |
| 5 边界与安全 | PASS | 新脚本零网络、零 spawn shell、零写用户资产；`execFileSync('git', ['--no-optional-locks','status','--porcelain'])` 参数数组无拼接；只读 4 套 ledger 与 registry；写盘仅 `acceptance/m-blueprint-2026-11-11/m0/`。 |
| 6 死代码/残留/补丁堆积 | PASS（一处 Minor） | 未新增 pass-through 包装；`WARN_BASELINE` 未使用常量已删。`STAGE_OWNER_MAP` 由 `Object.freeze` 表派生，未并造近亲。判「补丁 vs 重构」：M0 命中「perf 结论在两份文档互相矛盾」信号 ⇒ plan §判补丁 vs 重构 已写明 scoped 收敛（不垫第五层），既有两套历史生成器零改动。 |
| 7 最小化 YAGNI | PASS（一处 P2） | 零新增依赖；复用 `comparePerf`/`compareWarnDomains`/`adjudicateBaselineBinding` 既有纯函数，不重写判据；`lint-ledger-verify.mjs` 顶层无条件 `main()` 的副作用用子进程隔离而非改既有脚本。 |

## 发现

| 级别 | 位置 | 现象（合同原文） | 修法 | 状态 |
| --- | --- | --- | --- | --- |
| P2 | `scripts/m-blueprint-m0-criteria.mjs:185-189` `runChecks` | `protectedWip: ['POST-H9-OPTIMIZATION-BLUEPRINT-2026-11-10']` 把 post-h9 蓝图排除在 stale 判定外；契约依据 `test/post-h9-evidence-and-ledger.test.mjs:205` 断言 `postH9Registry === 'planned'` 且其本体是受保护未跟踪 WIP，翻转会同时打破断言与 `FRONTMATTER_STATUS_MISMATCH` 门 | 登记为 **W 类 done-partial**，补腿条件：owner 收口后由用户裁决统一翻转 registry/front-matter/README 三处并同步该契约断言；门参数显式列出而非静默跳过 | 已登记（`m0-gap-ledger-view.json:statusParity.excluded` + plan 收口段） |
| Minor | `scripts/m-blueprint-m0-criteria.mjs:243` `writeEvidence` | `gates` 数组是当次读数的人工录入，非脚本现取 | M4/M7 扩为门读数自动采集；本轮 `reconcileReadings` 已守住 3 个易漂移计数字段 | 已登记候选，不阻塞 |

## 回归→门禁转化

本包「新增测试未挂 impact-map rule」（W5a 抓真）是既有门禁**已有**机械项，非新缺陷类，无需转化；
「复合 stage 派生 owner 漏判」由本包 `LEDGER_OWNER_MISSING` 门一次性抓真并根修，属一次性事故，不转化。

## 范围守住

零产品行为变化（未改 `core/` `src/` `frontend/src/` 运行时代码）；零新增依赖；零放宽基线
（warnings 2445/2445、perf 阈值 493ms 与容差 30% 未动、knip 330、arch-cycles 12、silent-catch 412、code-size 86605 行）；
零 stage / 零提交 / 零触碰他方在制 WIP（仅 5 个 canonical 文件精确增量或字段翻转）；U/E/V/W 不代答。

G0 开发期常态 · 不外推 packaged/Provider/GA。
