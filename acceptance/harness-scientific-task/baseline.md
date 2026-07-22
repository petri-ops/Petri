# HRT-0 基线结论

HRT-0 已建立六类脱敏任务夹具，完整覆盖计划中的 20 项场景。它的出口是“真实任务驱动的契约输入已固定”，不是“所有 Harness 产品能力已经完成”。

## 已确认

- 新手自然语言任务、多步骤 Artifact lineage、歧义阻断均有主夹具。
- 普通会话/context assist、精准编辑、两次压缩、模型切换、持久化、缓存、用量和资源均有边界夹具。
- bulk RNA-seq 已画出主张 → 证据计划 → 模块 DAG → Artifact → 论据/限制链。
- 小型真实目录和 400 文件合成目录已建立冷/热索引基线；当前只记录 p50/p95，不冻结性能门槛。
- 所有用户数据、Job 结果和密钥均未进入证据包。

## 已知缺口

- `ScientificTaskSpec v1` 尚未冻结，这是 HRT-1 的任务。
- ContextCheckpoint、跨模型重建、会话级级联删除和损坏恢复尚未形成完整生产实现。
- tool trace 仍是短期内存状态，不能作为长期恢复唯一事实。
- cached token 尚未进入完整用量持久化，Provider 成本缓存只能作为后续基线。
- 系统资源监控与四处 UI snapshot 一致性尚未完成产品验收。
- 脚本快照已有运行目录基础，但复现包导出尚未完成产品化。
- 当前 capability 只接受 macos-arm64；其他平台不宣称支持。

## 永久性要求

本项目的硬性产品不变量是：用户未主动清除前，任务流、聊天原文、TaskSpec、Checkpoint、Job、Artifact 和复现证据都不得自动消失。当前代码已将聊天消息和 tool_job/结果分别落到 SQLite/磁盘，但 Agent loop 与 zombie job 在重启时会把遗留运行状态标记为失败，ContextCheckpoint/长期 Trace/跨重启 DAG 自动恢复仍未完成；这些对象不会因该状态转换而删除，但“自动续上”尚不是当前能力。

## 下一步

HRT-1 根据 `novice-bulk-rna-success`、`bulk-rna-multistep-lineage` 和 `ambiguous-metadata-block` 三个主夹具冻结 `ScientificTaskSpec v1`，并确保普通聊天不会误创建任务。
