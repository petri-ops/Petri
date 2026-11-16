# 审计广播台历史归档 · through 2026-11-12

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（BLOCK-170 自稳设计；
> 活跃台只留「最后更新」链最近 8 条，本档=被淘汰链行原文追加，搬移不改写）。
> 状态与完成语义以 canonical 文档（roadmap/plan/DOC-REGISTRY）为准，本档仅作广播历史追溯。

最后更新：2026-11-12（🏁 **BLOCK-439 端到端核对补漏 + 台账补登记**：补建并注册 BLOCK-436 发令文档（原 `aeda9abc` 只有代码）；补登记 f155dc22 / ca86d4ac / 22a4d2dd / e1282ed5 四次后续提交（复核补测 3 项 / 全量实测三层修 7 个失败 / 凭据与 agent 主链 + evals 1/9→8/9 / 完整 dev 栈启动与真页面收发消息）；机械遗漏 B2–B6 一次补齐——B2 仅重打 perf `coreSha`（阈值/容差零改动，`block350` 15/15）、B3 `BLOCK-264` 测试改用隔离 file 凭据后端不再依赖本机 Keychain、B4 `impact-map` 补挂 4 个生产文件（覆盖门 3/3）、B5 本条台账、B6 `scripts/m-blueprint-m0-wip-owner.mjs` 入库。核对结论：主体工作已完成并推送；凭据回退根因已定位并根治——test/block93-role-prompt.test.mjs 的 mock-key-block93 在 macOS 下经 login Keychain 覆盖用户真实 deepseek 账号（PETRI_LOCAL_DATA_DIR 隔离对 Keychain 无效），已给该测试与 block337 / evals-harness 隔离后端加 PETRI_CREDENTIAL_BACKEND=file，恢复 key 后跑完整 Node 全量仍稳定；`packaged_start` 陈旧产物与 79 个他方 UI 面 WIP 仍待外部条件。G0 开发期常态 · 不外推 packaged/Provider/GA.）
