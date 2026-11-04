# EAR（证据资产化率）口径定义（BLOCK-351 · 冻结）

- **冻结时间戳：2026-11-05T00:00:00Z（BLOCK-351 开工日，先于达标测量）**
- canonical 复算命令：`node scripts/block351-ear.mjs`（明细快照落 `acceptance/block-351/ear-snapshot.json`）
- manifest 棘轮台账：`acceptance/block-351/assetized-manifest.json`（由 `scripts/block351-build-manifest.mjs` 机械扫描生成——**手工编辑 manifest = 虚标**，再生成走 builder）

## 分子（assetized 文件数）

acceptance/ 下同时满足以下两条件的文件：

1. **断言承载**：被 `test/**/*.test.mjs` 源码字面引用（精确路径或其目录前缀）——即存在进门禁的测试以该文件（或其目录批）为断言对象（BLOCK-351 批次断言=证据完整性：可解析/非空/魔数/语义自洽 + 语义抽验）。
2. **impact-map 匹配**：`test/impact-map.json` 至少一条规则的 patterns 命中该文件路径。

## 分母

`acceptance/` 全部文件（递归），排除 README* 与 .DS_Store 等杂物。**禁止靠缩分母达标**；分母口径变更需显式裁决并留痕。

## 达标线与棘轮

- 达标线 **EAR ≥ 40%**（BLOCK-351 计划 §4 冻结）。
- `quality:ear` 门（--gate）= manifest 完整性棘轮：每条 entry 的 test 引用与 impact-map 引用任一丢失 → 红；EAR 低于 40% → 红。**只进不退**：后续包把更多证据转资产化后重跑 builder 抬高 manifest，禁止下调。

## 不可资产化（登记即止，不混入分子也不从分母剔除）

- 历史环境不可复现的一次性笔录（GUI 截图时序、人工目测记录等）：保留为分母，明确登记。
- 本批次已知形态：harness-loop/production/ui 部分 .png 为 JPEG 内容（历史工具链产物，不改写，断言按内容魔数放行）；.txt/.log 空文件=干净运行捕获（空=成功语义）。

## 基线数值（冻结时点）

- 冻结时点实测：**871 / 2013 = 43.3%**（≥40% 达标）。
- 前值参考（旧口径 ≈10%）：旧口径未区分「断言承载」与「仅存在」，无 manifest 棘轮，不可比；以本口径为准。
