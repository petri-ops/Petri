# UI-032 Harness 环境面板验收

日期：2026-07-21
状态：`verified`
主模块：`P-07 模型网关与 AI Provider`

## 验收结论

用户实机逐项验证通过，UI-032 收口：

- `设置 → 计算与数据 → Harness 分析环境` 面板可见且不影响原有执行位置/数据目录设置；
- 无已预备 bundle 时，空状态文案正常；
- 真实 capability bundle 条目可显示类型、名称、版本、大小和安装日期；
- 返回设置页与重启应用后，已准备条目保持可见，不重复下载；
- 真实分析流程继续复用 `run_tool → tool_job → artifact truth`，没有新增第二套执行器或结果状态；
- 前端只读调用 `harness-capabilities:list`，不提供绕过 Harness 编排层的 provision/remove 操作。

## 代码与门禁

- UI：`frontend/src/components/desktop/DesktopSettingsPanel.tsx` 的 `HarnessEnvironment`；
- IPC：`harness-capabilities:list`，经 preload 暴露；
- 后端：`core/shared-backend/capability-provisioning.js`；
- `npm run check` 与 UI 台账同步检查通过。
