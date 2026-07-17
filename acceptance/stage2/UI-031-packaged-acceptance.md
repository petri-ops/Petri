# UI-031 打包态实机验收清单（Stage 2 出口 · 第 6 条）

主模块：`P-07 模型网关与 AI Provider` · 关注点：`C-03 安全/确认/审计`、`C-04 状态与事件同步`

这是**纯人工**验收，无法脚本化。第 4/5 条（真实连通 / streaming / tool calling）用
`live-provider-check.mjs` 跑；本清单只覆盖打包态模型管理中心（UI-031）的交互与安全。

---

## 0. 前置条件（务必满足，否则结论无效）

- [ ] 跑的是**打包 `.app`**：`dist/mac-arm64/BioF3.app`（或 x64 对应产物），**不是 `npm run dev`**。
      理由：Keychain 行为、打包路径、native ABI 与开发态不同，只有打包态结论算数。
- [ ] 建议用隔离数据目录避免污染真实设置：启动前设 `BIOF3_LOCAL_DATA_DIR=/tmp/biof3-accept`。
      注意：**Keychain 是全局的**（按 service `com.biof3.desktop.ai`），隔离数据目录不隔离 Keychain 条目，验完需手动清理测试用 Keychain 项。
- [ ] R `:3001`、Python `:3004`、SPA `:3002` 健康（或动态端口就绪）。
- [ ] 记录环境：App 版本、macOS 版本、架构（arm64/x64）、日期。

配置落点（用于取证）：
- 设置：`~/Documents/BioF3-Local/ai-settings.json`（或 `$BIOF3_LOCAL_DATA_DIR/ai-settings.json`），权限应为 `0600`。
- 凭据：macOS → Keychain（service `com.biof3.desktop.ai`，account = provider id）；非 macOS → 同目录 `ai-credentials.json`（`0600`）。

---

## 1. 逐项验收

### 1.1 模型 CRUD
- [ ] 新增 Profile（provider / model / 自定义 baseUrl），保存。
- [ ] 编辑其中一个 Profile 的 model 或 baseUrl，保存。
- [ ] 删除一个 Profile，保存。
- 判据：`ai-settings.json` 的 `model_profiles` 与界面一致；删除被角色引用的 Profile 后，该角色绑定自动降级/出诊断，不崩。
- 证据：`/tmp/biof3-ui031-crud.png` + 保存后 `model_profiles` 片段（脱敏）。

### 1.2 角色绑定（8 类）
- [ ] chat / agent / planner / vision / embedding / summary / report / explanation 逐一可绑定。
- [ ] 能力过滤：给某角色选一个**缺少所需能力**的 Profile（如把 agent 绑到无 `tools` 的 Profile），确认出现 `model_capability_mismatch` 诊断，不允许静默使用。
- 判据：`model_role_bindings` 落盘正确；能力不匹配有可见诊断。
- 证据：`/tmp/biof3-ui031-roles.png`。

### 1.3 显式 fallback
- [ ] 默认关闭（`model_fallback_enabled=false`）。
- [ ] 打开开关，为某角色配置候选，保存。
- [ ] 配一个非法候选（=主模型 / 不存在 / 能力不符），确认出现对应诊断
      （`model_fallback_matches_primary` / `model_fallback_not_found` / `model_fallback_capability_mismatch`）。
- 判据：`model_fallback_enabled` / `model_fallback_bindings` 落盘正确；诊断可见。
- 证据：`/tmp/biof3-ui031-fallback.png`。

### 1.4 Keychain / 凭据不落明文（安全关键）
- [ ] 在凭据页为一个云 Provider 填 Key，保存。
- [ ] 打开 `ai-settings.json`：**确认无任何 `*_api_key` 字段、无明文 secret**，只有 `credential_status`（布尔）与 `credential_backend`。
- [ ] macOS：打开「钥匙串访问」，确认 service `com.biof3.desktop.ai` 下有对应 account 条目。
- [ ] 触发一次诊断导出（维护区），确认导出包/日志里**不含 Key、Authorization、完整敏感请求体**。
- 判据：明文密钥只存在于 Keychain（或非 macOS 的 `ai-credentials.json` `0600`），绝不进设置文件/渲染快照/诊断。
- 证据：`ai-settings.json`（脱敏截图）+ 钥匙串条目截图 `/tmp/biof3-ui031-keychain.png`。

### 1.5 连通性测试按钮
- [ ] 对已填 Key 的云 Provider 点“测试”，看到成功/失败反馈。
- 注意陷阱：测试打的是 `GET /models`；**有些兼容云不暴露 `/models`**，此时测试失败但真实 chat 可能正常 —— 以 `live-provider-check.mjs` 的真实 chat 结果为准。
- 证据：`/tmp/biof3-ui031-conntest.png`。

### 1.6 保存重开
- [ ] 保存全部配置 → **完全退出 App**（不是关窗）→ 重开。
- 判据：Profiles / 角色绑定 / fallback 配置 / 凭据状态全部恢复；已存 Key 仍可用（Keychain 持久）。
- 证据：重开后 `/tmp/biof3-ui031-reopen.png`。

### 1.7 聊天模型选择器同步
- [ ] 在设置里切换 active chat 模型 → 回到 SimpleChat，选择器同步为新模型。
- [ ] 在 SimpleChat 选择器切换 → 确认持久化（`active_chat_model_id` + `model_role_bindings.chat`）。
- [ ] 切换后**立刻发一条 chat**，确认用的是新模型（可对比回复风格或后端日志的 model 名）。
- 判据：设置面板与聊天共享同一 `useAiSettings` 缓存，双向同步且落盘。
- 证据：`/tmp/biof3-ui031-selector-sync.png`。

### 1.8 窄窗
- [ ] 把窗口缩到窄窗（约 ≤ 840px）。
- 判据：设置分类栏切换为顶部横向导航；模型卡片 reflow；无裁切/溢出/错位。
- 证据：`/tmp/biof3-ui031-narrow.png`。

---

## 2. 不允许破坏（回归红线）
- [ ] SimpleChat 现有模型选择正常。
- [ ] 设置页窄窗布局正常。
- [ ] Key 不回显。
- [ ] fallback 默认关闭。
- [ ] `run_tool → tool_job → artifact truth` 执行链未被模型层改造分叉。

---

## 3. 结论与签署

- [ ] 1.1–1.8 全部通过，2 无回归 → UI-031 具备转 `verified` 条件。
- [ ] 更新 `docs/ui-productization-audit.md`：UI-031 `in_progress → verified`，附本轮证据路径（同一提交）。
- [ ] 运行 `npm run ui:audit:check` 通过。

验收人：______  日期：______  App 版本/架构：______  macOS：______

> 只有本清单 + `live-provider-check.mjs`（第 4/5 条）全绿，Stage 2 出口才算满足。
> 之后再更新台账、决定下一 RC，并按“6 条完成后再 push”一次性推送。发布仍需单独授权。
