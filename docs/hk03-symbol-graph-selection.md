# HK-03 P0：符号图/导入边查询脚本——勘察选型

> 状态：P0 勘察收口，选型结论在案（方案 A）；P1 开工待用户裁决（HK 系列项内裁决点）。
> 来源：HK 系列 harness 工程实践吸收批（`docs/pending-work-backlog.md` 推进队列）；痛点锚点=CK-11 批次四手工导入边分类 78 条——词法 grep 在 JS 同名密集区全为假证据，当时只能逐条人工解析 require/import 说明符+导入方符号核查。
> 本文档是选型结论的 canonical（truthDomain: `symbol-graph-selection`）；P1 落地后实现细节与用法回写本文件。

## 1. 需求规格（「导入边精确分类」机械化）

把 CK-11 批次四的手工方法论固化为可执行查询：

- **边模型**：`{ importerFile, specifier, resolvedTarget?, importedSymbols[], usedSymbols[] }`——每条 import/require 边记录导入方、目标模块、导入的符号名集合、以及在导入方文件内的真实使用集合。
- **查询一 `who-imports <symbol>`**：全仓扫描哪些文件导入了该符号，并区分「导入但未使用」与「导入且使用」。
- **查询二 `classify-edges <file>`**：给定文件，列出其入边（谁导入了它的哪些导出、各自是否真实使用）与出边（它导入了谁的什么、是否使用），逐边给出分类。
- **三分类**：USED_PROD / USED_TEST（`*.test.*` 导入方）/ DEAD——与 CK-11 批次四人工三分类同构，回放可比。
- **解析口径**：AST 级（ESM import 声明 + CJS require() 及其解构 + 动态 import()），**禁止词法正则**——CK-11 实证词法证据在同名密集区不可靠。
- **诚实盲区（报告为 UNRESOLVED，不猜测）**：变量形式动态 require（resources 插件消费方）、按路径动态调用（.agents dev-verify flows）、字符串引用。与 knip 已登记盲区同构——只显式标注，不试图吞掉。

## 2. 可复用产物盘点（三项在位 + 一项不在位）

| 产物 | 现状 | 对本需求的可用性 |
| --- | --- | --- |
| typescript 5.9.3 | 根 devDependency（quality:types 门禁绑定） | **完整满足**：Compiler API（`ts.createSourceFile`）对 .ts/.tsx/.js/.cjs/.mjs 统一 AST 解析，import/require/动态 import 的说明符与具名导入全部结构化可得；**零新增依赖** |
| dependency-cruiser 18.3.1 | 根 devDependency（quality:arch 门禁绑定） | 模块级依赖图现成（可编程调 `cruise()`），但**无符号级**具名导入/使用分析——可作辅助 scoping，不满足核心需求 |
| knip 6.38.0 | pinned devDependency（quality:knip:check 棘轮绑定） | 自身做符号级未用导出分析，但属报告器非查询接口，无可编程「who-imports」面；其盲区清单直接复用为本脚本盲区清单 |
| ts-morph | 不在仓 | （对照项）typescript Compiler API 的易用包装，功能面同源 |

## 3. 选型对比与结论

| 方案 | 依赖面 | 符号级能力 | 判定 |
| --- | --- | --- | --- |
| **A. 既有 typescript Compiler API 直写 `scripts/symbol-graph.mjs`** | **零新增** | 完整（AST 级边提取 + 使用核查） | **推荐**——DEPENDENCY-CHANGE-CHECKLIST 默认「不增」天然满足；typescript 已被 quality:types/tsc 门禁绑定，无额外维护面 |
| B. 新增 ts-morph devDependency | +1 | 完整（同源 API 包装） | 不推荐——收益仅 API 人体工学，触发「新依赖需用户显式裁决」且无不可替代性 |
| C. dependency-cruiser 编程接口为主 | 零新增 | 缺失（仅模块级） | 不足——CK-11 方法论核心恰是符号级分类，模块级边答不了「导入但未用」 |

**结论：方案 A。** 依赖裁决点因「零新增」自然满足 CHECKLIST 默认答案；剩余裁决=P1 是否开工（用户）。

## 4. P1 落地要点（裁决通过后执行）

- 位置 `scripts/symbol-graph.mjs`（ESM，`import ts from 'typescript'`）；两查询 CLI 面：`node scripts/symbol-graph.mjs who-imports <symbol>` / `classify-edges <file>`。
- **红绿先行（HK-01 首次行使）**：先落两查询的失败契约测试（`test/symbol-graph.test.mjs`），再写实现转绿；夹具覆盖 .ts/.tsx/.js/.cjs 四形态 + 「导入但未使用」用例。
- **回放校验（P1 收口判据）**：以 CK-11 批次四定性账为对照集——保留边（40 USED_PROD/3 USED_TEST）重放须仍判 USED；已删死导出重放须判 DEAD/无引用；分歧逐条留痕。
- 明确不做（沿队列项）：不建常驻索引服务 / 不做 MCP 产品化（候选 C-13）/ 不引原生依赖 / 不动 knip 与 dependency-cruiser 既有语义。
- 门禁：新增契约测试 + docs:check + 受影响定向测试；P1 收口按轻量包回写。

## 5. 裁决记录

- 2026-09-26 P0 勘察收口：选型结论=**方案 A（零新增依赖）**；P1 开工裁决在用户。
