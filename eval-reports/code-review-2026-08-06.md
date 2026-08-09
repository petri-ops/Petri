# BioF3 Desktop 代码评审报告（2026-08-06）

评审人：Senior Developer ｜ 性质：只读复审 + 新增发现 ｜ 不改动任何资格状态与工作包状态
基线：在 `docs/project-wide-audit-2026-07.md`（六维横切审计）基础上逐项核实当前代码状态，并补充新发现。

> **当日修复进展（止血小包，已落地）**：P0-1（插件 sha256 fail-closed）、P0-2（轮询错误自愈）、P0-3（结果错误分类）、P2-5（端点补中间件）已修复并验证；UI 改动登记 UI-128（in_progress）。另顺手修复 `test/impact-map.json` 两处存量断点（g0-sdc1 脚本双重分类导致 `test:changed` 在 HEAD 全红；`acceptance/MODEL-ANTHROPIC-NATIVE/**` 未映射）。详见 `docs/AUDIT-LOG.md` 2026-08-06 处理记录。

---

## 一、总体判断

**核心矛盾未变：契约设计水平远高于契约执行水平。**
仓库里已有认真的校验层（`validateColumnSchema`、`path-safe.js`、descriptor 参数约束、webview 加固钩子），但多处仍未接到生产调用点。修复的主线动作始终是同一个：**把已写好的防线接到真实执行路径上**。

**值得肯定（别改回去）**：
- 2026-07 审计的最高危项已实质修复：`POST /api/run` 任意 R 执行洞已停用（410）并改用来源白名单 CORS；`/api/files/:key` 路径穿越已用 realpath 包含校验封堵；5/10 分钟双硬超时已重写为"心跳判活 + SIGTERM→SIGKILL 升级 + 回收真杀进程"。
- `git-adapter.js`（数组传参、禁 hooks、锁环境变量）仍是全仓安全质量标杆；MCP/HTTP 双路径 job 记录一致；前端 `any`/`@ts-ignore` 密度极低，TS strict 执行到位。
- result-studio/ 目录测试覆盖良好（每个组件 + 纯函数模块均有测试），治理门禁（docs:check / ui:audit:check / test-affected fail-closed）真实有效。

---

## 二、主要问题清单（按优先级）

### P0 — 应立即处理（安全 / 正确性硬伤）

| # | 问题 | 证据 | 优化方向 |
|---|------|------|----------|
| P0-1 | **插件供应链缺口：manifest 缺 sha256 时跳过校验直接安装**（"Week 4 placeholder" 遗留） | `src/plugin-manager.js:516-517, 699, 805-811` | 安装路径 fail-closed：无 sha256 一律拒绝或要求显式用户确认；补第三方插件签名校验测试 |
| P0-2 | **`fetchData` 轮询错误不清：一次瞬时失败 → 错误屏永驻，需刷新页面恢复**（真实 bug） | `frontend/src/pages/project-workspace.tsx:935-956, 1609` | 成功路径显式 `setError(null)`；错误守卫区分"致命加载失败"与"轮询瞬时失败"，瞬时错误降级为 toast |
| P0-3 | **结果 fetch 静默吞错，把网络/服务错误谎报为"分析已完成但未生成可视化结果"** | `project-workspace.tsx:3328, 4302-4305`（`catch{}` 注释 "keep shell quiet"）；`fetchDir:2075` 吞错伪装空目录 | catch 必须区分 404/文件缺失 vs 网络/5xx；后者给出带重试的错误态。UX1A 的 unavailable UI 已就位，只差错误分类 |
| P0-4 | **webview 零加固**：任意远程内容 + `allowpopups:true` + 地址栏放行任意 scheme（含 `file://`） | `src/main.js:879`（`webviewTag:true` 但无 `will-attach-webview` 钩子）；`project-workspace.tsx:4661`；`lib/browser-url.ts:4` | 主进程挂 `will-attach-webview` 强制 partition/preload/关 nodeIntegration；地址栏 scheme 白名单（http/https）；Electron 22+ 的 `new-window` 死代码删除 |
| P0-5 | **默认"完全访问模式" + full 模式跳过一切确认**，人在回路默认不存在 | `SimpleChat.tsx:210, 701` | 默认 `accessMode` 改 `'read'` 并持久化；移除/改造 120ms 自动批准；服务端缺字段时 fail-closed 而非判 full |

### P1 — 结构性技术债（本季度内规划）

| # | 问题 | 证据 | 优化方向 |
|---|------|------|----------|
| P1-1 | **"校验层写了不接生产"主矛盾**：descriptor 的 `minimum/maximum/options` 从不被读取校验，`params` 裸写 `params.json`；`validateColumnSchema()` 生产零调用 | `core/r-server/helpers/tools-executor.js:1814`、`mcp/registry.js:444`；`artifact-profiles.js:588` | 在执行入口前插统一参数校验中间件（读 descriptor 约束）；这是 SCI 类科学正确性问题（SCI-1~14）的总开关 |
| P1-2 | **科学正确性 14 项**（火山图默认未校正 p 值、DESeq2 静默接受 TPM/FPKM、GSEA 不可复现、基础设施故障伪装阴性结果等）——本轮未逐项复核，沿用 2026-07 审计结论 | 见 `docs/project-wide-audit-2026-07.md` §1 | 科研工具"错误结果 > 崩溃"：每项都可独立小修，建议按审计表逐条立项，先修 SCI-1/4/6（一行级） |
| P1-3 | **巨型文件持续膨胀**：`project-workspace.tsx` 4943 行（内联 ~900 行 ResultArtifactShell，零直接测试）；`db.js` 2083 行；`main.js` 2008 行；`tools-executor.js` 2000 行 | 各文件实测 | project-workspace 按"数据获取 / ResultArtifactShell / BrowserPanel / 预览"拆模块；db.js 拆 schema/CRUD/recovery；**先补表征测试再拆**，防止拆解引入回归 |
| P1-4 | **数据库层一致性**：2083 行混 DDL + ~20 处内联 `try{ALTER}catch{}` 与 migration-runner 双轨并存；112+ prepared statement 仅 1 处事务；py-server 与 r-server 状态机不一致（pending vs running、busy_timeout 5s vs 10s）并发写同一库 | `db.js:333-334, 445-459, 1248`；`py-server/r-server-db.js:29,61` | 内联 ALTER 全部迁入 migration-runner 版本追踪；多表写路径包事务；统一两个 server 的状态枚举与 busy_timeout |
| P1-5 | **API Key 明文回传渲染进程**，可一键批量导出 | `main.js:1069-1079`；`DesktopSettingsPanel.tsx:905-947` | 渲染进程只收掩码（`sk-••••`）；导出功能加二次确认 + 脱敏选项；考虑 safeStorage 加密落盘 |
| P1-6 | **两套路由 / 双实例 / 重复实现**：`useWorkspaceRouting` hook 生产零调用（死代码误导维护者）；双 SimpleChat 实例各自拉取消息；`formatSize` 4 份、手写 CSV 解析、手写 fetch 不复用已有 client 封装 | `hooks/useWorkspaceRouting.ts:32`；`CenterPanel.tsx:203` + `RightPanel.tsx:204`；`project-workspace.tsx:4926, 3116, 3314` | 删死 hook 或让它成为唯一真相；SimpleChat 消息状态上提共享；公共 utils 收敛到 `lib/` |

### P2 — 规范与可维护性（随日常迭代消化）

| # | 问题 | 证据 | 优化方向 |
|---|------|------|----------|
| P2-1 | 表格结果静默截断 24 行无任何提示（研究者会误以为差异基因只有 24 个） | `project-workspace.tsx:3955`；`:247,254` | 截断处加"仅预览前 24 行，共 N 行"提示 + 查看全部入口 |
| P2-2 | 性能：文件树 2s 全量轮询、15s 项目轮询、5s 终端快照三路并存；无任何列表虚拟化；vite 无 manualChunks | `:2126-2128, 1102, 4507` | 轮询合并为单一调度器 + 增量 diff；长列表引入虚拟化；构建侧拆 chunk |
| P2-3 | 错误观测性差：前端 ~24 处空 catch、r-server 内 `catch{}` 150+ 处；路由注册失败只 warn（模块静默消失）；`uncaughtException` 不退出（桌面单进程下是状态损坏风险） | `routes/index.js:38-44`；`server.js:77-80, 146-150` | 空 catch 至少接 logger；路由注册失败接入健康检查/启动自检；桌面环境 `uncaughtException` 应记录并重启渲染进程 |
| P2-4 | 脱敏覆盖不全：火山方舟裸 UUID、智谱 hex.b64 格式 key 不脱敏；落盘日志完全不脱敏（只在诊断导出时过一遍） | `redaction.js:27`；`main.js:95-101` | 脱敏模式库补全主流厂商 key 格式；日志写入点统一过 redaction |
| P2-5 | `/api/workspaces/:projectId/tree` 与 `/api/upload` 未挂 `requireTrustedDesktopOrigin`（同文件其他端点已挂） | `routes/files.js:161, 311` | 补齐中间件，保持边界一致 |
| P2-6 | 治理侧遗留（沿用既有登记）：27/73 份 acceptance 证据无生产者；P6 stored evidence 与当前源码树不 exact；8 份文档陈旧 | AUDIT-LOG 待评估项；GOV-2/5 | 无生产者证据按 P4R 先例降级 `unmeasured`；陈旧文档随 `docs:reconcile` 收敛 |

---

## 三、优化方向总览（给团队的行动框架)

```
第一层  止血（1~2 天）     P0-1 插件 sha256 fail-closed
                          P0-2/P0-3 前端错误处理两个 bug
                          P2-5 补中间件
第二层  收口（1~2 周）     P0-4 webview 加固 + P0-5 默认权限收紧
                          P1-5 API key 掩码
                          SCI-1/4/6 一行级科学修复
第三层  结构（本季度）     P1-1 参数校验接生产（SCI 总开关）
                          P1-3 巨型文件拆分（先表征测试）
                          P1-4 db 事务化 + schema 演进统一
第四层  净化（持续）       P2 各项 + 证据/文档治理
```

## 四、帮助团队提升的具体建议

1. **建立"防线接线检查"评审清单**：本项目反复出现的模式是"安全/校验模块写好了但没接线"。建议在 PR 模板中加一条：*新增校验/防护代码时，必须指明它在哪个生产调用点生效*。
2. **错误处理规范**：禁止裸 `catch{}` / `.catch(() => {})`；要求至少 `logger.warn` + 错误分类（用户错 / 网络错 / 服务错）。前端错误屏必须可自愈（下一轮成功即清除）。
3. **巨型文件红线**：单文件超 1500 行即触发拆分讨论；拆分前必须先有表征测试（characterization tests）。`project-workspace.tsx` 可作为团队重构练兵场，按 P1-3 的切分线做结对重构。
4. **科研正确性文化**：把"基础设施故障绝不可伪装成阴性结果"写进团队公约；R/Python 脚本默认参数、多重检验校正、随机种子、物种枚举校验做成 scaffold 模板（`harness:scaffold` 已存在，可把规则烧进去）。
5. **代码评审轮值**：建议用本报告 P0/P1 清单作为前两次评审会材料，逐条过"为什么这是问题 + 正确写法示例"，把审计结论转化为团队共识而非个人任务。

---

## 附：2026-07 审计发现复核结论

- **已修复（4 项）**：SEC-1 任意 R 执行、SEC-2 路径穿越、UX-2/BE-5 超时与僵尸回收、BE-1 createToolJob 静默降级
- **仍存在（~15 项）**：SEC-4/5/6(部分)/7、BE-2/3/4/6/7、FE-1~8 全部、UX-8、校验层未接生产
- **本轮新发现（4 项）**：P0-1 插件 sha256 缺口、P2-5 两个端点缺 origin 中间件、webPreferences 未显式声明 sandbox/webSecurity（低）、无句柄失活 job 只改库不杀进程（低）

> 本报告为只读评审，未运行全量测试，不改动任何资格/工作包状态。P0 项是否插队当前 active 工作包（G0-RS-UX1H）属用户决定，按单工作包串行纪律不自动插队。
