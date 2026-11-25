# 旧阶梯 G1–G6 原文留痕（item 39 · 2026-11-25）

> 来源：`docs/scientific-intelligence-os-vision.md` §10 的 G1–G6 旧段（重写前原文，逐字保留）。按治理「旧结论不覆盖不删除」纪律留痕。

### G1：Agent-native Scientific Analysis Platform

状态：`next`

目标：

- 从一个旗舰任务扩展到至少 3 个稳定科学任务包。
- 建立科学任务级输入、验证、异常、交付和复现标准。
- 补齐长任务资源、取消、恢复和环境治理。
- 让分析小白可以在最少必要提问下完成端到端任务。

建议旗舰任务：

1. Bulk RNA-seq 差异分析与功能解释。
2. 单细胞基础发现流程。
3. 富集、网络或空间分析中的一个完整任务。

阶段出口：

- 3 个任务包均覆盖正常、可修复和科学阻断。
- 任务包使用可组合 Plugin，不在 Harness Core 硬编码算法。
- 不同模型/Profile 不改变确定性科学验收。
- 真实数据规模下资源、恢复和交付可接受。
- 用户能够从结果追溯到脚本、参数、输入和限制。

### G2：Evidence-centered Research Workbench

状态：`later`

目标：

- 实现 Scientific Evidence Graph v1。
- 把 Question、Hypothesis、Evidence、Claim 和 Limitation 变成持久对象。
- 让图表、报告和科学主张引用同一证据图。
- 加入科学反证、替代解释和结论边界。

阶段出口：

- 至少 3 个真实项目使用 Evidence Graph 管理结果。
- Claim 能反向追溯到 Artifact、方法和数据。
- 新分析可以支持、削弱或修正旧 Claim。
- 报告和论文内容不复制出第二套科学状态。

### G3：Lab Scientific OS

状态：`future`

目标：

- 从个人项目扩展到课题组和实验室。
- 加入成员、角色、审阅、批准、版本和项目交接。
- 支持共享运行资源、数据范围和实验室知识。

阶段出口：

- 多成员协作不破坏项目事实和权限。
- 科学决策、图表和结论具有审阅记录。
- 项目可以在成员变动和设备迁移后继续。
- 实验室知识来自可追溯项目对象，不是无来源的共享摘要。

### G4：Federated Scientific Intelligence OS

状态：`future`

目标：

- 在 local-first 前提下接入 NAS、实验室服务器、HPC 和云计算。
- 支持更完整的转录组、单细胞、空间、代谢组、蛋白组和临床数据。
- 按数据隐私、资源、模型能力和成本选择执行位置。

阶段出口：

- 本地和远程 adapter 使用同一 Task/Job/Artifact/Evidence 契约。
- 远程运行不要求把所有数据上传第三方。
- 跨设备任务可恢复、审计和复现。
- 计算成本、数据范围和访问权清晰可见。

### G5：Scientific Capability Ecosystem

状态：`future`

目标：

- 冻结公共 Plugin、Task Pack、Evidence Pack 和 Validator 标准。
- 建立开发者工具、兼容矩阵、benchmark 和分发治理。
- 支持第三方能力而不牺牲科学质量、隐私和复现。

进入条件：

- 内置插件和任务包已经通过真实产品长期验证。
- 外部开发者需求真实存在。
- 版本、Runtime、权限和签名治理可以承担第三方风险。

### G6：Continuous Research System

状态：`north-star`

目标：

- 持续维护项目假设、证据、矛盾、限制和未解决问题。
- 从新数据和新结果中更新研究图谱。
- 生成可审阅的下一实验、下一分析和新问题建议。
- 长期陪伴一个研究项目，而不是只响应一次请求。

这仍然是需要科学家主导和审阅的研究系统，不是替代科学责任主体的自动研究机器。


---

## 旧命名留痕（item 39 第三步 · 2026-11-25 · 主人裁决「改」）

按留痕纪律逐字保留（文件名 `scientific-intelligence-os-vision.md` 不变，有 600+ 路径引用）：

- 旧标题：`# Petri Scientific Intelligence OS — 核心愿景与阶段成长宪章`
- 旧北极星：`长期北极星：Local-first Scientific Intelligence OS`
- 旧 G0 名称：`G0  Living Scientific Foundation` / `### G0：Living Scientific Foundation`
- 旧 G0 状态行：`状态：establishing；首个基线通过后转为 qualified + maintained，永不归档。`

新口径对齐 BLOCK-339 人设一句话（原文一字不动）；科研 OS 路线归 `petri-pack-bio` 自己的规划，不碰兄弟仓。G0 段本次仅名称与状态行对齐，定义/不变量/禁止项不动；G0 正文其余「科学」字样（科学宪法、科学准确性）涉及含义取舍，按令不改、列清单随回报。
