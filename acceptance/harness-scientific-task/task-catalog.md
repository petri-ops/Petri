# HRT-0 真实科学任务目录

> 状态：基线已建立。这里的“完成”表示场景、证据要求和当前缺口均已固定，不表示 HRT-1～HRT-7 的产品能力已经实现。

## 任务目录

| ID | 类型 | 原始需求摘要 | 主要覆盖 | 当前用途 |
|---|---|---|---|---|
| `novice-bulk-rna-success` | 新手成功路径 | “比较处理组和对照组，告诉我发生了什么” | 模糊需求、通俗预览、三种自动化模式、命令/资源/成本、科学证据链 | HRT-1 TaskSpec 主夹具 |
| `bulk-rna-multistep-lineage` | 多步骤科学任务 | DESeq2 后继续 GO/KEGG/GSEA，全部追溯同一 DEG | verified Artifact、bind_artifact、模块 DAG、论据/限制 | HRT-2～HRT-6 lineage 主夹具 |
| `ambiguous-metadata-block` | 歧义/阻断 | 文件存在但没有可证明的 group/contrast | 受控探针、`cannot_reliably_answer`、权限不提升科学证据 | HRT-1/HRT-2 阻断夹具 |
| `non-task-chat-and-context-assist` | 非任务会话 | 普通概念问答与项目精确阈值问答 | conversation/context_assist 分流、不误建 Job | 会话激活边界夹具 |
| `context-edit-compaction-model-switch` | 上下文完整性 | 精准修改、两次 checkpoint、大小窗口切换 | SHA 编辑、压缩恢复、模型切换和容量不足 | 上下文/编辑夹具 |
| `durability-cache-resource-baseline` | 平台恢复 | 重启后继续、判断缓存/用量/资源 | 持久化、授权隔离、缓存失效、资源快照 | 平台缺口基线 |

## 第一个科学问题

主张：处理条件是否导致可靠的差异表达，并得到功能通路证据支持。

```text
主张
  → 样本/设计是否有效
  → 表达矩阵质量是否可建模
  → DESeq2 差异模型
  → 标准 DEG Artifact
  → Volcano / GO-KEGG / GSEA
  → 统计事实、论据和限制
  → 脚本、参数、输入 hash、环境与复现包
```

模块独立运行；下游只接受 verified Artifact。最终图、表和报告必须有脚本快照或明确的脚本依赖链。

## 输入证据

HRT-0 只使用仓库内 demo 数据或合成脱敏数据，不读取真实用户项目：

- `resources/built-in-plugins/deseq2/demo-data/`
- `resources/built-in-plugins/gsea/demo-data/ranked_list.csv`
- `resources/built-in-plugins/go-kegg/demo-data/genes.csv`
- `test/fixtures/harness-scientific-task/data/metadata-disguised.csv`

## HRT-0 出口

- 六类任务均包含原始需求、输入、交付物、自动化边界、失败边界和新手成功路径。
- 需求 1～20 均有 fixture 覆盖。
- 七组指标文件已建立；未实现能力使用 `gap`，不伪造通过。
- 自动评测脚本验证结构、隐私、路径、覆盖和缺口诚实性。
- HRT-1 可以据此冻结 `ScientificTaskSpec v1`，但不能把 fixture 预期当成生产验收结果。

## 长任务呈现基线

完整任务由 `TaskSpec → Workflow/Task Pack DAG → Replay Manifest` 串联；不会把多个插件的 R 代码拼成一个不可维护的超级脚本。摘要卡片只投影 `workflowPlanRef`、`taskSpecHash`、当前步骤、Artifact Truth、资源 snapshot 和下一步动作；详细日志、参数和脚本快照进入 Job/Artifact 详情与复现包。

续跑基线：valid Artifact 的 step 跳过，failed/cancelled 只能通过带确认的 retry 创建新 Job，queued/running 异常先 reconcile，输入/插件/runtime/权限 hash 变化则从第一个受影响节点重新确认。当前实现具备 `resumeFromStepId`、`retry_run` 和 `reconcile_artifacts` 基础，但跨重启自动恢复仍记录为后续 gap。
