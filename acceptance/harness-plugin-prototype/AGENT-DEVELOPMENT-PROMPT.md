# 基础生信插件开发智能体提示词

将下面内容完整复制给新的智能体。智能体完成插件开发后，必须回到 Harness 主线，不得把本任务扩展为 Harness Core 重构。

```text
你现在负责在 Petri Desktop 中开发第一批基础生信分析插件模块。

工作目录：
<repo>

目标：
按照 Harness 插件规范开发可复用、可验证、可复现的基础分析插件。插件开发完成后回到 Harness 主线，不修改 Harness Core 的任务状态机、执行器、Job 表、Artifact Truth 或会话系统。

开始前必须阅读：
1. AGENTS.md
2. docs/AUDIT-LOG.md
3. docs/harness-scientific-task-contract-plan.md
4. docs/third-party-plugin-guide.md
5. docs/plugin-artifact-schema.md
6. acceptance/harness-plugin-prototype/README.md
7. acceptance/harness-plugin-prototype/plugin.json
8. acceptance/harness-plugin-prototype/tool-definition.json
9. acceptance/harness-plugin-prototype/environment.json
10. resources/built-in-plugins/deseq2/
11. resources/built-in-plugins/volcano-plot/
12. resources/built-in-plugins/pca-explorer/

当前阶段：
- 优先完成 macos-arm64 版本。
- 未完成 Windows/Linux runtime、bundle 和实跑验收前，不得宣称跨平台支持。

建议优先开发以下模块中的 1～3 个；已有功能重复时优先完善现有插件：
1. expression-qc：表达矩阵质量控制、样本测序量、缺失/低表达统计、相关性、PCA、QC 报告。
2. ranked-gene-qc：排序基因表质量检查、重复/缺失/覆盖率、分布图、标准化排序表。
3. result-table-filter：差异结果标准化、up/down 表、筛选统计和参数报告。

R 环境：
先检查当前系统 R 与已安装包：
Rscript -e 'cat(R.version.string,"\\n"); print(.libPaths())'
Rscript -e 'ip <- installed.packages(); print(ip[, c("Package","Version")], row.names=FALSE)'

可以使用当前系统 R 搜索包、检查版本和运行 demo，但：
- 不要把系统 R library 目录复制进 Git 仓库。
- 不要在插件脚本中调用 install.packages()。
- 不要调用 BiocManager::install()。
- 不要在分析运行期间联网下载包或数据。
- 重量级依赖写入 requiresBundle，由 Harness provisioning 准备。
- plugin.json 与 environment.json 的包版本必须一致。

插件目录必须包含：
resources/built-in-plugins/<plugin-id>/
├── plugin.json
├── tool-definition.json
├── environment.json
├── scripts/<plugin-id>.R
├── demo-data/
├── <plugin-id>-report-template.html
└── README.md

每个插件必须满足：
1. plugin.json、tool-definition.json、脚本 id 一致。
2. 输入契约明确列出格式、列名、方向、默认值和质量门槛。
3. 输出契约明确列出 table、plot、report 和 diagnostics；`artifact-manifest.json` / `provenance.json` 由 Harness 统一生成，不列为用户科研产物。
4. 图、表和报告均由插件脚本直接生成。
5. 每次运行记录插件版本、脚本快照/脚本 SHA-256、参数 hash、输入 SHA-256、R/包版本、输出 SHA-256 和重放命令。
6. 执行器复制出的 run-script.R 或 run-script.py 必须能够导出，历史 Job 的脚本不可覆盖。
7. 空结果作为有效科学结果处理。
8. 失败必须映射到结构化 failureModes，包括输入错误、运行时未就绪和平台不支持。
9. 至少提供 valid、empty-result、invalid-input fixture；缺环境时提供 runtime-not-ready 证据。

跨平台：
- 第一阶段 supportedPlatforms 只写 ["macos-arm64"]。
- macos-x64、windows-x64、linux-x64 写 planned，不得静默使用其他平台包。
- 脚本使用 job 相对路径，不硬编码 /Users/...，不依赖 macOS 专属 shell。
- 后续平台必须分别准备 runtime、capability bundle、URL、SHA-256、fixture 和 CI 证据。

验收命令：
npm run harness:check
npm run harness:phase6
npm run harness:plugins:acceptance:update
npm run harness:plugins:acceptance
npm run check
node --test test/plugin-sdk.test.mjs test/harness-workflow-fixtures.test.mjs

不要：
- 修改 Harness Core、执行器、Job 表或 Artifact Truth。
- 新增第二套执行器、Job 或工作流状态库。
- 修改用户真实数据。
- 提交 R library、密钥或本地绝对路径。
- 使用 git add . 或 git add -A。
- 根据预期生物学结论调节阈值。

最终报告必须包含：新增/修改文件、实际 R 包及版本、bundle 需求、平台边界、artifact 清单、重放命令、脚本二次修改方式、验收结果和未完成项。
```

## 使用方式

1. 新智能体先读取本目录的 `README.md` 和本文件。
2. 复制原型文件，不从空目录重新设计契约。
3. 完成插件后先运行验收命令，再把结果写回本插件的开发记录或交接消息。
4. 只有真实运行、脚本快照、Artifact lineage 和平台边界证据齐全，才允许进入正式插件清单。
