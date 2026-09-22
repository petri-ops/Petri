# BLOCK-114-TEST-FAILURE-TRIAGE 计划：测试失败归因分类器（决策内化弧 W1-4）

**Plan ID**：`BLOCK-114-TEST-FAILURE-TRIAGE`
**状态**：`active（P0-LAUNCH，2026-09-22 用户裁决「开 按顺序都做完」队列序第 4 点；弧线底稿=docs/planning/decision-primitive-internalization-arc.md §W1-4）`
**立项日期**：2026-09-22
**责任轨道**：BLOCK（开发者侧 dev-infra 工具 + 决策原语 dogfood；零产品面/零用户数据）
**上游文档**：弧线 §W1-4 · BLOCK-104 归因矩阵先例（33/36 人工归因）· BLOCK-102/104 测试加固

## 0. 立项来源与用户裁决留痕

- 弧线 W1-4（2026-09-21 登记）：「测试失败归因分类器……输入=失败签名+报错摘要+在册已知失败条目，确定性指纹先行、决策原语只接语义残差，低置信转人工；先例=BLOCK-104 归因矩阵（33/36）、test:changed 85/89 中『4 红在册』人工判读。开发者侧接点，不碰用户数据，出站顾虑最小，且是决策原语自身的第一份 dogfood」。
- **启动裁决（2026-09-22）**：用户裁决原话「开 按顺序都做完」（队列序第 4 点）。

## 1. 范围与非范围

### 1.1 范围

收口对账场景的测试失败自动归因。**三层管线（确定性先行，决策原语只接语义残差）**：

| 层 | 机制 | 输出 |
| --- | --- | --- |
| L1 指纹层（确定性） | 失败签名归一化（文件::用例名）哈希比对在册登记表 `known-failures.json` | known_existing（零模型调用） |
| L2 环境特征层（确定性） | 报错文本确定性模式（ECONNREFUSED/ETIMEDOUT/EPERM/ENOSPC/端口占用/句柄泄漏词表） | environment（零模型调用） |
| L3 语义残差层（决策原语） | 其余失败 → askDecision choice 四类（new_regression/known_existing/environment/flaky）+ confidence 门控 | conf ≥ θ 采纳；否则 needs_human 转人工 |

落点：`scripts/block114-failure-triage.mjs`（CLI：读测试输出文件/stdin → 逐失败归类 → JSON 报告）+ 分类内核 `scripts/lib/block114-triage-core.mjs`（供校准 harness 与契约测试复用）；在册登记表 `acceptance/block-114/known-failures.json`（repo 内维护，种子=BLOCK-102/104/105 在册项）。

| 阶段 | 内容 |
| --- | --- |
| P0 | 失败样本语料 ≥100 条（四类标注，构建法见语料 note）+ L3 校准 + D 项评审；证据 `acceptance/block-114/` |
| P1 | 分层管线实现 + 契约测试（指纹先行/环境词表/低置信转人工/降级五态） |
| P2 | 真实场景 dogfood：对最近一次全量测试输出跑分类器对账 + closeout 十门 |

### 1.2 非范围（exclusions）

- 不接入 closeout 门禁链（v1 独立 dogfood 工具；入链另行裁决——避免「分类器误判掩盖真回归」风险）。
- 不自动重跑（flaky 判定 v1 只基于文本特征与登记表；自动重跑机制另裁）。
- 不碰 test/impact-map 的 fail-closed 红线（弧线 W1-5 增量建议为独立点）。
- 测试「卡住」检测纯工程手段（A 型：超时器，弧线 §W1 同日澄清）——不在本包。

## 2. P0 预登记裁决项（D-1~D-5）

- **D-1 类目集**：choice 四类 `new_regression`（新引入的断言/逻辑失败）/ `known_existing`（在册已知失败）/ `environment`（网络/权限/磁盘/端口等环境失败）/ `flaky`（时序抖动、随机顺序依赖类）。L1/L2 层先行消费 known_existing 与 environment 的确定性子集，L3 对残差全类判别。
- **D-2 state**：单条失败的归一化摘要（文件+用例名+报错类型+首行消息 ≤600 字）。
- **D-3 门控阈值**：L3 conf ≥ θ 采纳，否则 needs_human（转人工）。P0 取「new_regression 误判为非回归 =0」约束下的最高覆盖档——**把新回归误判成环境/存量是本工具最危险错误，零容忍**。
- **D-4 部署形态**：独立 CLI（`node scripts/block114-failure-triage.mjs <output.txt>`），不入 closeout 链。
- **D-5 指纹规范**：`sha1(file::testName).slice(0,12)`；登记表条目含 {fingerprint, testFile, testName, classifiedAs, note, registeredAt}；环境词表在 L2 维护（代码内常量+契约测试钉住）。

## 3. 关闭语义

- 正常完成：P0 证据门（L3 accuracy ≥0.85 且 new_regression 误放行=0、θ 下采纳精度 ≥0.95）→ P1 → P2 dogfood + closeout 十门 → completed。
- PoC 失败语义：L3 不达标 → 收缩为纯 L1/L2 确定性工具（决策原语层诚实放弃），仅冻结本点。

## 4. 验收门禁清单

- P0：`acceptance/block-114/calibration.json`（≥100 样本、L3 曲线、θ 初值）+ 语料 + 登记 表入库。
- P1：`test/block114-failure-triage.test.mjs`（指纹命中零模型/环境词表零模型/低置信 needs_human/新回归零误放行/降级五态）。
- P2：对最近全量测试输出（或合成输出）跑分类器，报告落 `acceptance/block-114/dogfood.json`；closeout 十门全绿；impact-map 登记 `block114-failure-triage`。

**预期节奏**：一次会话收口（纯 dev 侧，无 dev-stack 依赖）。

## 5. 红线与风险

- 决策必经 decision-api；key 不入仓；缺 key/失败 → 全部失败条目 needs_human（工具失效不产生错误归类）。
- **A 型红线**：指纹层与环境词表是确定性判断，永不模型化（弧线 §3.2 反模型化防线）。
- 风险：语料真实度（以本仓历史真实失败形态为模板编拟）；分类器误判掩盖回归（D-3 零容忍 + needs_human 兜底 + 不入 closeout 链）。
