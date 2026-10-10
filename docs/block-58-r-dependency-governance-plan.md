# BLOCK-58 — R 工具依赖治理：install.packages 移出执行路径

> 状态：`completed`（P0–P5 收口，2026-09-03）
> 立项日期：2026-09-03（AUDIT-LOG 🟠 广播项「R/Python 环境审计（第三轮）」转 active）
> truthDomain: `block-58-r-dependency-governance`
> 来源：AUDIT-LOG 2026-09-03 🟠 R/Python 环境审计（第三轮）——tool-scripts 运行时内联 install.packages 破坏可复现性

## 1. 背景与根因

≥7 个内置 R 工具脚本（consensus-cluster / mo-snf / shap-explain / ml-classifier / rsf-survival / mo-mofa / ml-feature-select）在**执行路径**内联 `install.packages(repos="cloud.r-project.org")`（脚本头部 `need_pkgs` 循环 + mo-mofa 的 BiocManager 分支 + ml-feature-select 的散装 ranger 安装）。三重问题：

1. **非确定性**：今天装 3.6 明天装 3.7，provenance 声称可复现但依赖树不可控，侵蚀 Artifact Truth；
2. **CRAN 网络不受控**：大包（xgboost / randomForestSRC / caret）编译安装可撞 30min 硬超时误杀；
3. **绕过 builtAgainst 预编译包版本对齐卡**。

**根因（本包摸底确认）**：正确的机制**早已存在**——工具插件（volcano-plot / go-kegg 等）在 manifest 声明 `packages.r` 依赖 + `builtAgainst`，安装时 [plugin-manager.js](../src/plugin-manager.js) 调 `executor.installPackages` 把**预编译包**复制进 `R_HOME/library`，运行时 `checkPackageInstalled` 毫秒级查目录。而 7 个内置 tool-scripts **不在插件体系里**：无 manifest、无 packages 声明、无预编译包——脚本只能自己联网兜底。

**本机实测（2026-09-03）**：R 4.5.2（399 包）对 7 脚本所需 26 个依赖**缺 16 个**（Boruta / ConsensusClusterPlus / MOFA2 / SNFtool / caret / iml / mRMRe / mclust / pec / randomForestSRC / timeROC / xgboost / VennDiagram / pROC / ranger / survminer）——当前工具确实靠内联安装才跑得通，方案必须同时提供显式补装通道。

## 2. 方案（执行路径净化 + 依赖清单单一事实源 + 显式补装命令）

### P1 — 依赖清单单一事实源 `_dependencies.json`

- `core/petri-server/tool-scripts/_dependencies.json`：脚本 → 包清单（含来源 CRAN/Bioconductor），与各 `_scope.md` 范围卡对齐；
- 7 个 R 脚本的 `need_pkgs` 循环 / BiocManager 分支 / 散装 ranger 安装**全部移除**，改为读清单的 fail-fast：缺包时输出结构化错误（`MISSING_R_PACKAGES: pkg1, pkg2` + 安装指引）并 `quit(status=1)`，**绝不联网**；
- 行为变化（如实登记）：缺包环境下工具从「慢但能跑（首次静默装包）」变为「毫秒级明确失败 + 指引」——这正是审计裁决方向（分析路径永不碰网络）。

### P2 — 执行前检查（JS 侧，缺包拒绝在提交前）

- run_tool 执行链在提交 tool_job 前毫秒级 `checkPackageInstalled` 扫描目标脚本依赖（读 `_dependencies.json`），缺失直接拒绝执行，返回缺失清单 + 指引（`scripts/install-r-tool-dependencies.mjs` 或未来插件）；
- 检查逻辑可单测（临时假 R_HOME）。

### P3 — 显式补装命令 `scripts/install-r-tool-dependencies.mjs`

- 读 `_dependencies.json`，CRAN/Bioconductor binary 优先安装，完成后**打印实际安装版本快照**（用户显式运行的一次性维护动作，不进分析路径）；
- 版本漂移的完整解法（预编译包插件 `petri-r-toolchain`：manifest packages.r 清单 + builtAgainst 4.5.2 + 构建产物进 OSS）**登记为后续候选**——涉及 CRAN 下载/编译与发布面，另立包不混入本包。

### 非范围

- 不做 petri-r-toolchain 预编译包插件的实体构建（构建/发布面，候选另立）；
- 不动工具插件（volcano-plot 等）体系——它们已是正确形态；
- 不动 py-executor / Python 脚本依赖（本次审计未发现同等问题，观察项）；
- 0 新 npm 依赖。

## 3. 阶段

- **P0 立项**：本计划 + DOC-REGISTRY + roadmap/AUDIT-LOG（🟠 项转 active）。
- **P1 实现**：`_dependencies.json` + 7 脚本 fail-fast 化。
- **P2 执行前检查**：JS 侧扫描 + 拒绝链路 + 单测。
- **P3 补装命令**：install-r-tool-dependencies.mjs。
- **P4 门禁**：脚本静态断言（无 install.packages）+ JSON/脚本一致性校验 + JS 检查单测 + docs:check + ui:audit:check。
- **P5 收口**：真实 R 环境验证（本机 Rscript 补装后跑通至少一个工具脚本冒烟）+ 提交。

## 4. 验收门

- 7 脚本 grep 零 `install.packages`；缺包场景输出结构化错误非零退出；
- `_dependencies.json` 与脚本 `library()` 引用一致（校验脚本）；
- JS 执行前检查：缺包拒绝（含缺失清单）/ 满足放行，node --test；
- 本机 R 冒烟：P3 补装后至少一个脚本真实跑通；
- 治理：docs:check + docs:reconcile 收口必跑；G0 开发期常态 · 不外推 packaged/Provider/GA。

## 5. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 缺包环境工具从「能跑」变「失败」 | fail-fast 错误给明确安装指引；P3 显式补装命令；行为变化在 plan/AUDIT-LOG 如实登记 |
| 补装命令仍走 CRAN（版本漂移） | 安装后打印版本快照；完整解法（预编译包插件）登记候选，本包如实声明边界 |
| 依赖清单与脚本漂移 | P4 一致性校验（JSON ↔ library() 引用比对）纳入门禁 |
| 并行包冲突 | 文件面 = tool-scripts/*.R + _dependencies.json + scripts/ 新文件 + run_tool 链（core/petri-server 内，非 agent-tools/vision-tools）——与 BLOCK-52（agent-tools 两文件）零重叠；提交前核对 git status |

## 6. 进度记录

- 2026-09-03 P0（active 登记）：用户裁决立项（🟠 广播项转 active，三包并行：BLOCK-52 收口中 + BLOCK-53 遗留 S5 + 本包）；摸底完成——根因=内置 tool-scripts 在插件体系外无预编译包，机制缺口而非机制缺失；本机 R 实测缺 16 包写入背景。0 新 npm 依赖。
- 2026-09-03 P1 实现：`_dependencies.json`（7 工具 18 个工具专属包，source cran/bioc；runtimeProvided 7 个基础包）；7 脚本安装段（need_pkgs CRAN 循环 / mo-mofa BiocManager 变体 / ml-feature-select 散装 ranger）全部替换为 MISSING_R_PACKAGES fail-fast（`quit(status=1)`，零联网）；R 语法 parse 全过；缺包冒烟实测（本机缺 SNFtool → 结构化输出 + exit 1 瞬回）。**实测修正**：petri 权威 R（~/Documents/Petri-Local/runtimes/R，399 包）缺 15 个，其中 pROC/VennDiagram 原判为 runtimeProvided 实为工具专属——已移入 ml-classifier/ml-feature-select 的 packages；survminer 补入 rsf-survival。
- 2026-09-03 P2 实现：`helpers/tool-dependencies.js`（loadToolDependencies + checkToolDependencies + missingPackagesMessage，清单坏/缺/清单外脚本一律放行由脚本内 fail-fast 兜底）+ tools-executor.js `executeJob` R 分支接线（仅非插件脚本，缺包 markJobFailed(stage='dependencies') 提前拒绝派生）。
- 2026-09-03 P3 实现：`scripts/install-r-tool-dependencies.mjs`（--tool/--check；Rscript 定位 PETRI_R_HOME → Petri-Local 默认位置 → PATH；CRAN/Bioc binary 优先；安装后版本快照打印）。
- 2026-09-03 P4 门禁：`test/tool-scripts-dependencies.test.mjs` 4/4（零 install.packages 静态断言 / JSON↔library 一致性 / checkToolDependencies 缺失·放行·清单外 / 指引文案）；tools-executor 相关回归 capability-bundle-wiring 4/4；`execution-conversation-threading.test.mjs` 存量基建失败（`no such table: projects`，db migration 缺失，与本包改动零交集，如实登记）。治理门禁：docs:check 200 PASS；ui:audit:check 因并行包 BLOCK-52 未提交 WIP（frontend 文件）报不同步——非本包（本包零 UI 文件面），提交分离后即恢复。
- 2026-09-03 P5 冒烟收口：`--tool mo-snf` 真实补装（mclust 6.1.3 / SNFtool 2.3.1 binary + 版本快照）→ 重跑脚本**通过 fail-fast 进入正常执行流**（`source(NA/_petri-theme.R)` 为未传 job_dir 的预期参数错误，证明依赖检查放行）→ --check 缺失从 15 降为 14。G0 开发期常态 · 不外推 packaged/Provider/GA。
