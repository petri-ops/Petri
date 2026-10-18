---
capability: external-agent-import
goal: BLOCK-209 = runlist W7d（阶段 4 C-4）＝ **外部 Agent 配置导入（Codex / ZCode → Petri）的只读解析与映射预览**：解析外部配置文件、把能映射的键映射成 Petri 注册表键、把不能映射的键**如实列成 unsupported**、把凭据**一律拒绝自动导入**（D-2），全过程**零写入、零网络**。**本包不做"一键应用"**——应用需要逐键审批与回滚设计，属 reopen。
acceptance:
  - P0 基线：`test/block209-external-agent-import.test.mjs` 冻结三件事——①映射表（Codex `model`/`model_provider`/`openai_base_url`/`approval_policy`/`sandbox_mode` 的最小集合）；②**凭据识别清单**（任何键名含 api_key/token/secret 的值不得进入 `patch`，只进 `credentialsDetected`）；③不支持键必须进 `unsupported`（不静默吞）。
  - P1 解析：`core/shared-backend/external-agent-import.js`（零依赖、纯函数）：`parseCodexConfig`（TOML 子集：注释/引号/布尔/节）、`parseZCodeConfig`（JSON）、`detectFormat`。
  - P2 映射：`mapToPetri` 返回 `{patch, credentialsDetected, unsupported, notes, diagnostics}`；`patch` 里只允许出现**注册表里真实存在的键路径**（与 `shared-config` 对账，防"映射出一个不存在的键"）。
  - P3 写面：`POST /api/import/external-agent` **只做预览**（dry-run，永不写盘）；非法/过大输入 400 + diagnostics；凭据命中时返回明确的 D-2 提示文案。
  - P4 合规：**不拷贝任何外部实现**（只读其配置文件格式；仓库内无 Codex/ZCode 源码）；不新增依赖（TOML 子集自写，不引 toml 库）。
  - P5 收尾：closeout 十三门；文件规模与 impact-map 登记。
  - 完成语义：**预览不是导入**——交付说明必须写清"本包不写任何设置"。真正的应用（含逐键确认与回滚）属 reopen。
reopen: 一键应用（逐键确认 + 回滚 + 审计）；Codex 九层优先级与 profile 语义的等价合并；ZCode 全量约 150 项映射；外部配置里的 MCP server 清单导入；凭据迁移（必须走显式确认 + 凭据库）。
status: completed
---

# BLOCK-209 · 阶段 4 C-4：外部 Agent 配置导入（只读解析 + 映射预览）

执行序位置=`docs/stage-3-4-execution-runlist.md` 的 **W7d**（W0–W7c 已 completed）。用户发令：2026-10-18「行！ 开整 下一包W7d」。

## 0. P0 勘察

- Codex 配置事实来源=`docs/settings-capability-gap-analysis-2026-10-15.md` §Codex 行（103 顶层键 / 九层优先级 / profile / requirements 约束层）。
- ZCode 配置事实来源=同文档 §2（≈150 项按组）。
- 本仓已具备：注册表键路径（`shared-config`）、四档审批语义（`runtime.approvalDefaultMode`）、凭据库（`credential-store`，D-2 禁止明文入导出/快照）。

## 1. 判定：纯解析 + 映射，不碰写入

导入的难点不在解析，而在**"映射不上时怎么诚实"**与**"凭据怎么不进来"**。因此 v1 只做预览：把能映射的键、不能映射的键、被拒绝的凭据分三张清单交给用户/上层，再由人来决定应用——这也让本包可以零风险落地（零写入）。

## 2. 红线

- **不拷贝实现**：只读配置格式，不引外部源码；不新增依赖（TOML 子集自写）。
- **凭据零自动导入**：检测到即列入 `credentialsDetected` 并附 D-2 提示；`patch` 里**不允许**出现任何凭据值。
- **映射的键必须真实存在**：`patch` 的每个键都要能在 `shared-config` 里找到（测对账），否则就是"映射出一个不存在的配置"。
- 不写盘、不联网、不碰 G1+。

## 3. 落地记录（2026-10-18）

- **P1**：`core/shared-backend/external-agent-import.js`（零依赖纯函数）：`parseCodexConfig`（TOML 子集：注释/引号/布尔/数字/节；**数组表与内联表列 unsupported 不猜**）、`parseZCodeConfig`（JSON）、`detectFormat`（显式 source 优先）。
- **P2**：`mapToPetri` 输出 `{patch, credentialsDetected, unsupported, notes, diagnostics}`；patch 只放**可保守映射**的一项（`runtime::approvalDefaultMode`），模型/渠道信息只进 `notes`（协议与计费需人工确认）；Codex `approval_policy`+`sandbox_mode` 冲突时**取更严**。
- **P3**：`POST /api/import/external-agent/preview`——空/超长内容 400，响应带 `dryRun:true`/`wrote:false`。
- **P4 合规**：零依赖（TOML 子集自写，不引 toml 库）、零外部源码；凭据按**键名与值形态双查**，只进 `credentialsDetected`。
- 证据：`test/block209-external-agent-import.test.mjs` **8/8**（格式识别/Codex 解析/映射与取严/D-2 双查/ZCode 最小集/键对账/坏输入/HTTP 面）。
- 诚实边界：**预览不是导入**——本包不写任何设置；一键应用（逐键确认 + 回滚 + 审计）属 reopen。
