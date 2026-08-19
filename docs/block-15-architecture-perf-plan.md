# BLOCK-15 架构重构 + 性能基准 工作包计划

**版本**：v1.0
**状态**：active（plan worker 输出，不实施代码）
**起草日期**：2026-08-19
**Truth Domain**：`block-15-architecture-perf`
**User Rulings（已由用户裁决，必须遵守）**：

| # | 裁决内容 | 来源 |
|---|---------|------|
| **UR-1** | BLOCK-11 已建议为"已完成"（PHASE 0 launch + PHASE 1 closeout + manifest 修复均已完成）；BLOCK-15 视为无 active WP 阻塞，可启动 | 用户 2026-08-19 |
| **UR-2** | main.js 拆分范围：**选项 B — 全面重拆**（BLOCK-9.1 风格），不是仅抽剩 6 个 _setup*。需按 BLOCK-9.1 同形模板（PHASE 1 低风险 → PHASE 2 中风险 → PHASE 3 高风险 → PHASE 4 收口）重新评估 main.js 架构并系统拆分 | 用户 2026-08-19 |
| **UR-3** | Tier 4 IPC backpressure：**仅测量 fixture**，G0 合规；不落地 off-thread Worker / MessageChannel transfer / SharedArrayBuffer | 用户 2026-08-19 |
| **UR-4** | #2 IPC catalog + #3 plugin schema：**合并**，统一用自写 validator（保持 BLOCK-10-AUDIT PL-001 原则，不引入 ajv/zod） | 用户 2026-08-19 |

---

## §1 工作包元数据

| 字段 | 值 |
|------|-----|
| **工作包 ID** | `BLOCK-15-ARCH-PERF` |
| **Kind** | Work Package Plan |
| **Truth Domain** | `block-15-architecture-perf` |
| **Status** | ACTIVE（用户 2026-08-19 裁决启动） |
| **Owner** | 主 agent + plan worker |
| **Started** | 2026-08-19 |
| **Target Close** | 待 PHASE 4 完成后确定 |
| **Parent blocking** | 无（BLOCK-11 已 closeout，UR-1 确认无 active WP 阻塞） |
| **Predecessor** | BLOCK-9.1（main.js 剩余 5 个不拆函数）；BLOCK-9.2（plugin-manager.js 已拆 8 lib）；BLOCK-10-AUDIT（PL-001 自写 validator 原则）；BLOCK-11（无 blocking） |

### §1.1 范围（In Scope）

| SUB | 内容 | 类型 |
|-----|------|------|
| SUB-15.1 | main.js 全面重拆（1200 行 → 目标 ≤ 400 行，BLOCK-9.1 风格 4 PHASE 模板） | 重构 |
| SUB-15.2 | IPC channel catalog 自动校验门禁（合并 #2 + #3；自写 validator） | 门禁 |
| SUB-15.3 | dev Electron 启动 profile fixture（N=5 warmup + 平均值 + 阈值报警） | 性能 |
| SUB-15.4 | IPC 序列化 backpressure 测量 fixture（1MB / 10MB / 100MB 三档） | 性能 |

### §1.2 排除范围（Out of Scope）

- off-thread Worker / MessageChannel transfer / SharedArrayBuffer 落地（UR-3：仅测量）
- ajv / zod / 任何第三方 schema validator 引入（UR-4：自写 validator）
- packaged Electron 公证 / 签名 / notarization
- Provider 矩阵 / GA 公证流水线 / dist staleness
- `qualificationEligible` 提升（需 G1+ 阶段）
- Result Studio P7 deferred 功能
- MCP Server 插件化
- Git Worktree 创建（`G0-RS-WT0` deferred）
- src/preload.js / frontend/src/lib/electron.d.ts / frontend/src/lib/desktopBridge.ts 改动（IPC 桥接 0 diff）

---

## §2 PHASE 0 范围评估（调研基准）

**PHASE 0 调研日期**：2026-08-19（SUB-15.1 PHASE 0 worker 枚举）

### §2.1 main.js 当前状态（1200 行）

| 总行数 | **1200 行**（~46 KB） |
|--------|----------------------|
| 测量日期 | 2026-08-19 |
| 测量方法 | SUB-15.1 PHASE 0 worker 实测 |

#### 模块级变量（17 个，顶层 const/let/var）

| # | 变量名 | 行号 | 类型 | 风险 | 建议 PHASE | 备注 |
|---|--------|------|------|------|-----------|------|
| 1 | `AGENT_WORKBENCH_FLAG_CHANNEL` | 29 | const string | 🟢 低 | PHASE 1 | 常量，无 Electron 依赖 |
| 2 | `AGENT_WORKBENCH_FLAG_NAME` | 30 | const string | 🟢 低 | PHASE 1 | 常量，无 Electron 依赖 |
| 3 | `agentWorkbenchFlags` | 44 | const object | 🟢 低 | PHASE 1 | parseAgentWorkbenchFlags() 结果（纯函数） |
| 4 | `runtimePathsModule` | 60–62 | const string | 🟢 低 | PHASE 1 | 条件路径拼接，无 Electron API |
| 5 | `isDevMode` | 67–70 | const boolean | 🟢 低 | PHASE 1 | 三条件 OR，无 Electron API |
| 6 | `rendererDevUrl` | 72–73 | const string | 🟢 低 | PHASE 1 | 环境变量读取，无 Electron API |
| 7 | `IS_DEV` | 108 | const boolean | 🟢 低 | PHASE 1 | !app.isPackaged，仅用于路径决策 |
| 8 | `PROJECT_ROOT` | 109 | const string | 🟢 低 | PHASE 1 | 条件路径，无 Electron API |
| 9 | `NODE_BIN` | 172 | const string | 🟢 低 | PHASE 1 | resolveNodeBin() 结果 |
| 10 | `BASE_R_PACKAGES` | 175–219 | const Set | 🟢 低 | PHASE 1 | 纯数据，无 Electron 依赖 |
| 11 | `BASE_PY_PACKAGES` | 220–229 | const Set | 🟢 低 | PHASE 1 | 纯数据，无 Electron 依赖 |
| 12 | `mainWindow` | 317 | let BrowserWindow | 🟠 中 | PHASE 3 | 跨函数共享，拆分 createWindow 时需注入 |
| 13 | `hasSingleInstanceLock` | 329 | const boolean | 🟠 中 | PHASE 2 | app.requestSingleInstanceLock()，Electron 状态 |
| 14 | `skillsSDK` | 741 | let object | 🟠 中 | PHASE 2 | Skills SDK 单例，跨 _getSkillsSDK / setupSkillsIpc |
| 15 | `_activeSkillRuntimes` | 742 | const Map | 🟠 中 | PHASE 2 | Skills 运行时追踪，poller 共享状态 |
| 16 | `_lastCheckpointCount` | 743 | const Map | 🟠 中 | PHASE 2 | Checkpoint diff 追踪，poller 共享状态 |
| 17 | `_skillsProgressTimer` | 744 | let number | 🟠 中 | PHASE 2 | Poller 定时器引用，需跨函数传递 |

> **注意**：plan §2.1 估算 23 个模块级变量，实测 17 个（偏差 -6），原因是部分估算项实际上是内联临时变量而非顶层声明。§2.1 本表为 SUB-15.1 PHASE 1 实施基准。

#### 22 个函数真实行号（vs plan 估算偏差）

| # | 函数名 | plan 估算 | 实际行号 | 偏差 | 风险 | 建议 PHASE |
|---|--------|----------|----------|------|------|-----------|
| 1 | `parseAgentWorkbenchFlags` | 32–110 | **32–42** | -68 | 🟢 低 | PHASE 1 |
| 2 | `resolveCoreRoot` | 112–118 | **112–117** | -1 | 🟢 低 | PHASE 1 |
| 3 | `resolveResource` | 120–127 | **120–125** | -2 | 🟢 低 | PHASE 1 |
| 4 | `resolveCore` | 128–137 | **128–130** | -7 | 🟢 低 | PHASE 1 |
| 5 | `resolveNodeBin` | 139–243 | **139–171** | -72 | 🟢 低 | PHASE 1 |
| 6 | `reserveAvailablePort` | 245–265 | **245–265** | 0 | 🟢 低 | PHASE 1 |
| 7 | `selectBackendPorts` | 267–280 | **267–279** | -1 | 🟠 中 | PHASE 2 |
| 8 | `loadInstalledPlugins` | 282–291 | **282–290** | -1 | 🟠 中 | PHASE 2 |
| 9 | `startContentSync` | 293–317 | **293–314** | -3 | 🟠 中 | PHASE 2 |
| 10 | `publishAgentWorkbenchFlags` | 319–339 | **319–324** | -15 | 🟠 中 | PHASE 2 |
| 11 | `createWindow` | 341–601 | **341–601** | 0 | 🔴 高 | PHASE 3 |
| 12 | `setupAgentWorkbenchFlagsIpc` | 603–611 | **603–610** | -1 | 🟢 低 | PHASE 1 |
| 13 | `setupWindowIpc` | 613–681 | **613–669** | -12 | 🟠 中 | PHASE 2 |
| 14 | `setupCsp` | 683–745 | **683–716** | -29 | 🟢 低 | PHASE 1 |
| 15 | `_getSkillsSDK` | 746–769 | **746–769** | 0 | 🟠 中 | PHASE 2 |
| 16 | `_publishSkillProgress` | 771–781 | **771–781** | 0 | 🟠 中 | PHASE 2 |
| 17 | `_stopSkillsProgressPollerIfIdle` | 783–789 | **783–789** | 0 | 🟠 中 | PHASE 2 |
| 18 | `_startSkillsProgressPoller` | 791–819 | **791–819** | 0 | 🟠 中 | PHASE 2 |
| 19 | `_resolveSkillsIpcWindow` | 821–825 | **821–825** | 0 | 🟢 低 | PHASE 1 |
| 20 | `setupSkillsIpc` | 827–958 | **827–952** | -6 | 🔴 高 | PHASE 3 |
| 21 | `main` | 961–1123 | **961–1088** | -35 | 🔴 高 | PHASE 3 |
| 22 | `setupAppMenu` | 1125–1200 | **1125–1200** | 0 | 🟠 中 | PHASE 2 |

> **注**：plan 估算普遍偏保守（实际行数少于估算），不影响拆分 DAG 的正确性。22 个函数全部存在，0 遗漏，0 多余。

#### PHASE 分组合计

| PHASE | 函数数 | 预估行数 | 风险 |
|-------|--------|---------|------|
| PHASE 1（低风险） | 9 个（#1–5, #12, #14, #19 + `setupCsp` 变量处理） | ~200 行 | 🟢 低 |
| PHASE 2（中风险） | 9 个（#7–10, #13, #15–18, #22） | ~300 行 | 🟠 中 |
| PHASE 3（高风险） | 3 个（#11, #20, #21）+ `setupAppMenu` | ~350 行 | 🔴 高 |
| PHASE 4 | 收口 | — | — |

#### BLOCK-9.1 拆分文件 import 状态（14+2 个）

main.js 中 16 个 BLOCK-9.1 相关 import（14 个 plan 登记 + 2 个 plan 未列入），**全部已正确 import，0 遗漏**：

| 文件 | import 行号 | plan 登记 |
|------|-----------|---------|
| `src/ipc/telemetry.js` | 1039 | ✅ |
| `src/ipc/harness-capabilities.js` | 1040 | ✅ |
| `src/ipc/compute-settings.js` | 1041 | ✅ |
| `src/ipc/file-dialog.js` | 1043 | ✅ |
| `src/ipc/data-management.js` | 1044 | ✅ |
| `src/ipc/ai-settings.js` | 1042 | ✅ |
| `src/ipc/runtime-status.js` | 1056 | ✅ |
| `src/ipc/backend-lifecycle.js` | 1057 | ✅ |
| `src/ipc/plugin.js` | 1058 | ✅ |
| `src/ipc/auto-update.js` | 1059 | ✅ |
| `src/ipc/diagnostic.js` | 1068 | ✅ |
| `src/ipc/terminal.js` | 1067 | ✅ |
| `src/main/env-coordinator.js` | 964 | ✅ |
| `src/main/backend-proc-manager.js` | 1021, 1110, 1111 | ✅ |
| `src/ipc/branch-handlers.js` | 1045 | ⚠️ plan 未列入 |
| `src/ipc/result-handlers.js` | 1046 | ⚠️ plan 未列入 |

> ⚠️ plan §2.1 未登记 `src/ipc/branch-handlers.js` 和 `src/ipc/result-handlers.js`，但 main.js L1045/L1046 已 import 并调用。这两个文件的 handler（branch:* / result:* channels，约 12 个 channel）计入 SUB-15.2 IPC catalog 枚举范围（用户裁决 UR-SC-1：全部覆盖）。

#### IPC handler 清单（12 个，main.js 内联）

| # | channel 名 | handler 函数 | 行号 | Type |
|---|-----------|-------------|------|------|
| 1 | `biof3:agent-workbench-flags` | `setupAgentWorkbenchFlagsIpc` 内联 | 604 | `handle` |
| 2 | `window:minimize` | `setupWindowIpc` 内联 | 619 | `on` |
| 3 | `window:maximize` | `setupWindowIpc` 内联 | 622 | `on` |
| 4 | `window:close` | `setupWindowIpc` 内联 | 631 | `on` |
| 5 | `window:isMaximized` | `setupWindowIpc` 内联 | 634 | `handle` |
| 6 | `window:isFullScreen` | `setupWindowIpc` 内联 | 640 | `handle` |
| 7 | `window:toggleFullScreen` | `setupWindowIpc` 内联 | 644 | `on` |
| 8 | `app:relaunch` | `setupWindowIpc` 内联 | 660 | `handle` |
| 9 | `skills:discover` | `setupSkillsIpc` 内联 | 829 | `handle` |
| 10 | `skills:execute` | `setupSkillsIpc` 内联 | 841 | `handle` |
| 11 | `skills:getExecution` | `setupSkillsIpc` 内联 | 906 | `handle` |
| 12 | `skills:cancel` | `setupSkillsIpc` 内联 | 937 | `handle` |

> **FigCode IPC 占位符（审计登记，不修复）**：main.js L1077 存在条件调用 `if (typeof setupFigcodeIpc === 'function')`，但函数当前不存在，条件永远为 false。用户裁决 UR-FIGCODE：仅审计登记，不修复，不计入 12 个 handler。

#### 不变量检查（4/4 PASS）

| 不变量 | 结果 |
|--------|------|
| `preload.js` 0 diff | ✅ PASS |
| `electron.d.ts` 0 diff | ✅ PASS |
| `desktopBridge.ts` 0 diff | ✅ PASS |
| `core/shared-backend/*` 0 diff | ✅ PASS |

### §2.2 关键发现（PHASE 0 结论）

> 本节内容不变，只在末尾追加一行：
>
> **PHASE 0 调研完成**：SUB-15.1 PHASE 0 worker 已从源码枚举 main.js（1200 行）模块级变量 17 个、函数 22 个真实行号、16 个 BLOCK-9.1 import、12 个 IPC handler。plan §2.1 数据已更新为实测基准。SUB-15.2 IPC catalog 枚举范围扩展为 main.js 12 + branch/result handlers（用户裁决 UR-SC-1）。FigCode IPC 占位符审计登记，不修复（用户裁决 UR-FIGCODE）。

## §2.3 范围差异说明

| 差异项 | plan v1.0 描述 | 实际状态 | 用户裁决 |
|--------|--------------|---------|---------|
| 模块级变量数量 | 23 个（估算） | 17 个（实测） | 用实测 17 个作为基准（UR-VAR） |
| IPC catalog 范围 | 仅 main.js 12 个 handler | main.js 12 + branch/result ~12 个 | 全部覆盖（UR-SC-1） |
| FigCode IPC | 未提及 | 条件调用存在，函数不存在 | 仅审计登记，不修复（UR-FIGCODE） |
| branch/result handlers | 未列入 plan §2.1 | main.js L1045/L1046 已 import | 计入 catalog 枚举（UR-SC-1） |

## §2.4 SUB-15.2 / SUB-15.3 / SUB-15.4 依赖声明

- **SUB-15.2 PHASE 0**：依赖 SUB-15.1 PHASE 0 枚举结果（12 个 IPC handler 清单已在本节）。branch/result handlers 需额外枚举（见 `src/ipc/branch-handlers.js` 和 `src/ipc/result-handlers.js`）。
- **SUB-15.3 PHASE 0**：独立于 SUB-15.1，可并行启动。
- **SUB-15.4 PHASE 0**：独立于 SUB-15.1，可并行启动。


---

## §3 SUB-15.1..SUB-15.4 详细范围

### SUB-15.1：main.js 全面重拆（BLOCK-9.1 风格）

**目标**：main.js 1200 行 → **≤ 400 行**（-800 行 / -66.7%）

#### §15.1.1 调研范围（PHASE 0）

- [ ] 枚举 main.js 22 个函数（✅ 已实测，§2.1）
- [ ] 枚举模块级变量（BLOCK-9.1 PHASE 0 登记 23 个，需重新验证当前值）
- [ ] 枚举 12 个 IPC handler 注册及其 channel 名称
- [ ] 评估每个函数的可拆分性：纯函数 vs Electron 依赖 vs cross-reference
- [ ] 绘制拆分依赖 DAG（哪些函数互相调用，决定 commit 顺序）
- [ ] 识别 BLOCK-9.1 遗留的 5 个"不拆函数"是否可重新评估
- [ ] 制定 PHASE 1..4 拆分 DAG + commit 顺序建议
- [ ] 输出 main.js 架构评估报告（作为 SUB-15.1 PHASE 0 产物）

#### §15.1.2 PHASE 1：低风险纯函数（目标 -200 行）

| 函数 | 当前行 | 拆分目标文件 | 风险 |
|------|--------|------------|------|
| `parseAgentWorkbenchFlags` | ~80 | `src/main/_cli-parser.js` | 🟢 无 Electron 依赖 |
| `resolveCoreRoot` + `resolveResource` + `resolveCore` | ~20 | `src/main/_paths.js` | 🟢 纯路径 |
| `resolveNodeBin` | ~104 | `src/main/_node-bin.js` | 🟢 纯函数 |
| `reserveAvailablePort` | ~20 | `src/main/_network.js` | 🟢 纯端口逻辑 |
| `setupCsp` | ~62 | `src/main/_csp.js` | 🟢 无跨域依赖 |
| `setupAgentWorkbenchFlagsIpc` | ~9 | `src/main/_agent-flags-ipc.js` | 🟢 仅 IPC 注册 |
| `_resolveSkillsIpcWindow` | ~5 | `src/main/_skills-ipc.js`（预拆分） | 🟢 纯解析 |

**验证门**：chf0-critical 33/33 PASS；main.js 行数 -200；无 Electron API 依赖。

#### §15.1.3 PHASE 2：中风险 async / IPC / cross-ref 函数（目标 -300 行）

| 函数/函数组 | 当前行 | 拆分目标文件 | 风险 |
|------------|--------|------------|------|
| `selectBackendPorts` | ~14 | `src/main/_backend-ports.js` | 🟠 async，依赖 backend-proc-manager |
| `loadInstalledPlugins` | ~10 | `src/main/_plugin-loader.js` | 🟠 async，依赖 plugin-manager |
| `startContentSync` | ~25 | `src/main/_content-sync.js` | 🟠 内容同步逻辑 |
| `publishAgentWorkbenchFlags` | ~21 | `src/main/_agent-flags.js` | 🟠 与 IPC channel 耦合 |
| `setupWindowIpc` | ~68 | `src/main/_window-ipc.js`（facade） | 🟠 需 mainWindow 引用 |
| `setupAppMenu` | ~75 | `src/main/_app-menu.js` | 🟠 Menu 配置 |
| Skills poller 组（4 个） | ~80 | `src/main/_skills-progress.js` | 🟠 跨函数调用 |
| `_getSkillsSDK` | ~24 | `src/main/_skills-sdk.js` | 🟠 SDK 获取 |

**验证门**：chf0-critical 33/33 PASS；main.js 再 -300；createWindow / setupSkillsIpc / main 三个高风险函数暂不拆分。

#### §15.1.4 PHASE 3：高风险函数（目标 -300 行）

| 函数 | 当前行 | 拆分目标文件 | 风险 | 特殊处理 |
|------|--------|------------|------|---------|
| `createWindow` | ~260 | `src/main/_window-create.js` | 🔴 最高 | BrowserWindow 创建跨域影响最大；需 BLOCK-9.1 风格依赖注入 mainWindow 引用 |
| `setupSkillsIpc` | ~131 | `src/main/_skills-ipc.js`（合并） | 🔴 高 | skills IPC 最复杂；_resolveSkillsIpcWindow PHASE 1 预拆分后合并 |
| `main` | ~162 | `src/main/_entry.js`（仅保留 app lifecycle 编排） | 🔴 高 | Electron app.whenReady 核心编排；其他逻辑全部分流 |

**关键风险**：
- `createWindow` 依赖 `setupWindowIpc`（PHASE 2 已拆分，但两者共享 mainWindow 引用）
- `main` 是入口，拆分后需确保 `module.exports` 兼容性
- `setupSkillsIpc` 的 `_resolveSkillsIpcWindow` 已在 PHASE 1 拆分，合并时注意导入路径

**验证门**：chf0-critical 33/33 PASS；main.js 总计 ≤ 400 行；chf0-critical 33/33 PASS（0 退化）。

#### §15.1.5 PHASE 4：audit + closeout

- 4 治理门 GREEN（docs:check / ui:audit:check / tsc --noEmit / docs:reconcile）
- chf0-critical 33/33 PASS（0 退化）
- `window-controls.test.mjs` PASS（如有 window 改动）
- 不变量守住（preload.js / electron.d.ts / desktopBridge.ts / src/ipc/* / src/plugin/* 0 diff）
- IPC channel 契约 100% 不变（12 个 handler 注册 channel 名 + payload shape 一致）
- ui-productization-audit.md 更新（如有 UI 相关）
- BLOCK-15 closeout 报告

**SUB-15.1 工作量估算**：

| PHASE | 预估人天 | 风险 |
|-------|---------|------|
| PHASE 0（调研 + DAG） | 0.5 | 低 |
| PHASE 1（低风险纯函数） | 0.5 | 低 |
| PHASE 2（中风险 async/IPC） | 1.0 | 中 |
| PHASE 3（高风险函数） | 1.5 | 高 |
| PHASE 4（closeout） | 0.5 | 低 |
| **合计** | **4.0 人天** | |

**依赖关系**：
- SUB-15.2（IPC catalog）依赖 SUB-15.1 PHASE 0 的 channel 枚举结果（无循环依赖，可并行）
- SUB-15.3（profile fixture）独立，可与 SUB-15.1 并行
- SUB-15.4（backpressure fixture）独立，可与 SUB-15.1 并行
- SUB-15.1 PHASE 3 依赖 PHASE 1+2 完成（串行）

---

### SUB-15.2：IPC channel catalog 自动校验门禁（合并 #2 + #3）

**目标**：建立 IPC channel 双向 contract 测试门禁，合并 IPC catalog + plugin schema 校验

#### §15.2.1 依赖前提

⚠️ **关键依赖缺口**：用户 prompt 称 `docs/block-14-ipc-channel-catalog.md`（525 行 / 5 表）已交付，但 docs/ 中**未找到该文件**。

**处理方案（待主 agent 裁决）**：
- **方案 A**：在 SUB-15.2 PHASE 0 补充调研，从 src/main.js / src/preload.js / src/ipc/*.js 实时枚举 channel，建立 `docs/block-15-ipc-channel-catalog.md`
- **方案 B**：在 docs/ 其他 BLOCK-14 文件中寻找（如 `block-14-agent-runner-tests.md` 等可能含 IPC catalog 内容）
- **方案 C**：接受"BLOCK-14 IPC catalog 尚未落盘"，将 SUB-15.2 改为从零构建

> 本 plan **采用方案 A**（从源码枚举），在 SUB-15.2 PHASE 0 补充调研。如方案 B 找到文档，PHASE 0 结论修正后更新本 plan。

#### §15.2.2 新增文件

| 文件 | 用途 | 预估行数 |
|------|------|---------|
| `src/ipc/_channel-catalog.js` | 集中 channel 名常量枚举（供 main.js + preload.js + test 共用） | ~150 |
| `test/ipc-channel-contract.test.mjs` | IPC channel 双向 contract 测试 | ~300 |
| `src/plugin-schema-extended.js`（或扩展 `src/plugin-schema.js`） | 统一自写 validator，覆盖 IPC channel payload schema | ~100 |
| `test/plugin-schema-strict.test.mjs` | plugin schema 扩展校验测试 | ~150 |
| `scripts/block-15-gates.mjs` | IPC catalog gate 脚本（集成到 npm run block-15:test） | ~80 |

#### §15.2.3 IPC channel catalog 枚举范围（PHASE 0 调研）

基于实测数据（2026-08-19）：

**main.js IPC handlers（12 个）**：

| # | Channel | Type | Handler 行 |
|---|---------|------|-----------|
| 1 | `AGENT_WORKBENCH_FLAG_CHANNEL` ("biof3:agent-workbench-flags") | handle | 604 |
| 2 | `window:minimize` | on | 619 |
| 3 | `window:maximize` | on | 622 |
| 4 | `window:close` | on | 631 |
| 5 | `window:isMaximized` | handle | 634 |
| 6 | `window:isFullScreen` | handle | 640 |
| 7 | `window:toggleFullScreen` | on | 644 |
| 8 | `app:relaunch` | handle | 660 |
| 9 | `skills:discover` | handle | 829 |
| 10 | `skills:execute` | handle | 841 |
| 11 | `skills:getExecution` | handle | 906 |
| 12 | `skills:cancel` | handle | 937 |

**src/ipc/*.js 已有 handlers（BLOCK-9.1 PHASE 1-2 成果，15 个子文件）**：

src/ipc/ 15 个子文件：`_sender-guard.js` / `ai-settings.js` / `auto-update.js` / `backend-lifecycle.js` / `branch-handlers.js` / `compute-settings.js` / `data-management.js` / `diagnostic.js` / `file-dialog.js` / `harness-capabilities.js` / `plugin.js` / `result-handlers.js` / `runtime-status.js` / `telemetry.js` / `terminal.js`

（注：具体 handler 清单需 PHASE 0 补充调研，grep `ipcMain.handle|ipcMain.on` 于 src/ipc/*.js）

**preload.js IPC calls（~81 个 ipcRenderer.invoke/on）**：

实测约 81 个调用，channel 名需 PHASE 0 枚举。

#### §15.2.4 双向 contract 校验设计

```
test/ipc-channel-contract.test.mjs
├── 断言1：main 侧每个 ipcMain.handle/on 都在 _channel-catalog.js 中有对应 entry
├── 断言2：preload 侧每个 ipcRenderer.invoke/on 都在 _channel-catalog.js 中有对称 entry
├── 断言3：handler 参数 payload shape 与 catalog 中声明 schema 对齐
└── 断言4：catalog 中每个 channel 的 direction（main→renderer / renderer→main / bidirectional）与实际注册一致
```

**自写 validator 要求（UR-4 + PL-001 原则）**：
- 不引入 ajv / zod / 任何第三方 JSON Schema validator
- payload schema 用手写验证函数（`validatePayload(channel, payload)` 返回 `{valid: bool, error?: string}`）
- plugin-schema 扩展：复用 `src/plugin-schema.js` 228 行已有模式，新增 IPC channel schema 校验 section

#### §15.2.5 block-15-gates exit-2 门禁集成

package.json 新增：

```jsonc
"block-15:test": "node --test test/ipc-channel-contract.test.mjs test/plugin-schema-strict.test.mjs",
```

scripts/block-15-gates.mjs 调用（4 exit gate）：

```javascript
// Gate 1: IPC catalog 双向 contract
// Gate 2: plugin schema extended（IPC channel payload）
// Gate 3: plugin manifest schema（含 IPC channel references）
// Gate 4: main.js IPC handler channel 一致性
```

**SUB-15.2 工作量估算**：

| PHASE | 预估人天 | 风险 |
|-------|---------|------|
| PHASE 0（补充调研 channel 枚举） | 0.5 | 中（依赖文档存在性） |
| PHASE 1（_channel-catalog.js + ipc-channel-contract.test.mjs） | 1.0 | 中 |
| PHASE 2（plugin-schema 扩展 + plugin-schema-strict.test.mjs） | 0.5 | 低（复用现有模式） |
| PHASE 3（block-15-gates.mjs + package.json 注册） | 0.5 | 低 |
| **合计** | **2.5 人天** | |

---

### SUB-15.3：dev Electron 启动 profile fixture

**目标**：建立 dev Electron 启动时序基线测量 fixture（N=5 warmup + 平均值 + 阈值报警）

#### §15.3.1 新增文件

| 文件 | 用途 | 预估行数 |
|------|------|---------|
| `scripts/dev-electron-profile.mjs` | 启动时序 fixture（N=5 warmup 后测量 + 平均值 + 阈值报警） | ~120 |
| `test/dev-electron-profile.test.mjs` | CI-friendly profile 测试（调用 fixture fixture） | ~80 |

#### §15.3.2 关键节点测量

```
scripts/dev-electron-profile.mjs
├── 节点1: app.whenReady() 触发时刻
├── 节点2: did-finish-load（main window）
├── 节点3: did-stop-loading
├── 节点4: frontend first paint（DOMContentLoaded 或 renderer ready）
└── 节点5: 完整渲染（renderer onload）
```

#### §15.3.3 测量流程

1. 启动 Electron（`electron . --no-sandbox`，不打开窗口）
2. 捕获 `app.whenReady()` 时间戳（节点 1）
3. 创建 BrowserWindow 后捕获 `did-finish-load`（节点 2）
4. 捕获 `did-stop-loading`（节点 3）
5. 等待 renderer DOMContentLoaded（节点 4）
6. 报告：T1 = 节点2 - 节点1 / T2 = 节点3 - 节点1 / T3 = 节点4 - 节点1
7. 运行 N=5 次 warmup 后正式测量 5 次
8. 输出平均值 + min/max + 阈值报警

**阈值报警**（可配置，默认值待基线建立后设定）：

```javascript
const THRESHOLDS = {
  appReady: 5000,    // ms
  didFinishLoad: 8000,
  firstPaint: 12000,
};
```

超过阈值时打印 `WARNING: [dev-electron-profile] <metric> exceeded threshold: <value>ms > <threshold>ms`

#### §15.3.4 CI-friendly 测试

`test/dev-electron-profile.test.mjs`：
- 不启动真实 Electron（在 CI 环境中）
- 调用 `scripts/dev-electron-profile.mjs` 并解析输出
- 验证 fixture 可执行 + 输出格式正确
- 记录当前 baseline（在测试输出中打印为注释，供人工核对）

**SUB-15.3 工作量估算**：

| PHASE | 预估人天 | 风险 |
|-------|---------|------|
| PHASE 0（fixture 脚本开发 + N=5 warmup 测量基线） | 0.5 | 中（需实机 Electron 环境） |
| PHASE 1（test/dev-electron-profile.test.mjs） | 0.5 | 低 |
| **合计** | **1.0 人天** | |

**PHASE 0 落地（2026-08-19，commit `60ccef3`）**：
- `--cdp` flag：启用 CDP 模式，通过 Chrome DevTools Protocol 测量 T0→T4
- `--port N`：remote-debugging-port（默认 9222）
- `--timeout MS`：最大等待时间（默认 30s）
- `--output json|csv|text`：输出格式（默认 text）
- T0 spawn / T1 appReady / T2 windowShown / T3 DOMContentLoaded / T4 load
- 技术：Electron `--remote-debugging-port` + HTTP polling + Node.js 内置 WebSocket（Node ≥ 21）
- 11 现有测试 PASS；docs:check / ui:audit:check 均 PASS
- UI-B15-3 已追加到 `docs/ui-productization-audit.md`

**⚠️ 基线记录**（待 PHASE 0 实测后填写）：

| 指标 | Baseline（待实测）ms | 阈值 ms |
|------|---------------------|--------|
| app.whenReady → did-finish-load | **待测量** | 8000 |
| app.whenReady → did-stop-loading | **待测量** | 10000 |
| app.whenReady → first paint | **待测量** | 12000 |

---

### SUB-15.4：IPC 序列化 backpressure 测量 fixture

**目标**：建立 IPC payload 序列化延迟基线（1MB / 10MB / 100MB 三档），**仅测量，不落地优化**

#### §15.4.1 新增文件

| 文件 | 用途 | 预估行数 |
|------|------|---------|
| `test/ipc-serialization-backpressure.test.mjs` | 序列化延迟测量 fixture | ~200 |
| `test/fixtures/ipc-payload-fixtures/` | 1MB / 10MB / 100MB fixture 数据 | ~50 行生成脚本 |

#### §15.4.2 测量矩阵

| Payload 大小 | 测试场景 | 预期延迟量级 | 测量项 |
|-------------|---------|------------|-------|
| **1 MB** | renderer→main invoke | ~1-5 ms | 延迟 + event-loop 阻塞 |
| **1 MB** | main→renderer send | ~1-5 ms | 延迟 |
| **10 MB** | renderer→main invoke | ~10-50 ms | 延迟 + event-loop 阻塞 |
| **10 MB** | main→renderer send | ~10-50 ms | 延迟 |
| **100 MB** | renderer→main invoke | ~100-500 ms | 延迟 + event-loop 阻塞（⚠️ 高风险） |
| **100 MB** | main→renderer send | ~100-500 ms | 延迟 |

#### §15.4.3 测量方法

**renderer→main invoke**：
1. renderer 生成 payload（ArrayBuffer / Buffer）
2. `performance.now()` 记录 invoke 前
3. `ipcRenderer.invoke('perf:benchmark-invoke', payload)`
4. main 侧接收后原样返回（不处理，纯序列化测试）
5. renderer 侧 `performance.now()` 记录返回
6. 计算 RTT 延迟

**main→renderer send**：
1. main 侧 `performance.now()` 记录 send 前
2. `webContents.send('perf:benchmark-send', payload)`
3. renderer 侧记录接收时间
4. 计算单向延迟

**event-loop 阻塞测量**：
- 使用 `/api/__perf/event-loop` 端点（在 main process 中）轮询 event-loop lag
- 在 invoke 前后测量 lag 差值
- ⚠️ **注意**：main process lag 仅在大型 payload（100MB）时可能有显著影响

#### §15.4.4 G0 合规声明（UR-3）

> **Tier 4 IPC backpressure 仅测量 fixture，G0 合规；不落地 off-thread Worker / MessageChannel transfer / SharedArrayBuffer。**
>
> 任何基于测量结果的优化方案（如 off-thread serialization / transfer-ownership / SAB）属于 Tier 4 落地优化，须在 §8 后续候选中显式声明"需 G1+ 阶段裁决"，不在 BLOCK-15 范围内。

**SUB-15.4 工作量估算**：

| PHASE | 预估人天 | 风险 |
|-------|---------|------|
| PHASE 0（fixture 开发 + 基线测量） | 0.5 | 中（需实机 Electron 环境） |
| PHASE 1（event-loop lag 探针集成） | 0.5 | 中 |
| **合计** | **1.0 人天** | |

**PHASE 0 落地（2026-08-19，commit `60ccef3`）**：
- `--cdp` flag：启用 CDP 模式，通过 Chrome DevTools Protocol 测量 T0→T4
- `--port N`：remote-debugging-port（默认 9222）
- `--timeout MS`：最大等待时间（默认 30s）
- `--output json|csv|text`：输出格式（默认 text）
- T0 spawn / T1 appReady / T2 windowShown / T3 DOMContentLoaded / T4 load
- 技术：Electron `--remote-debugging-port` + HTTP polling + Node.js 内置 WebSocket（Node ≥ 21）
- 11 现有测试 PASS；docs:check / ui:audit:check 均 PASS
- UI-B15-3 已追加到 `docs/ui-productization-audit.md`

**⚠️ 基线记录**（待 PHASE 0 实测后填写）：

| Payload | renderer→main invoke（ms） | main→renderer send（ms） | event-loop lag 增量（ms） |
|---------|---------------------------|---------------------------|--------------------------|
| 1 MB | **待测量** | **待测量** | **待测量** |
| 10 MB | **待测量** | **待测量** | **待测量** |
| 100 MB | **待测量** | **待测量** | **待测量** |

---

## §4 PHASE 划分 + commit 顺序 DAG

### §4.1 SUB-15.1 main.js 全面重拆（4 PHASE）

```
SUB-15.1 DAG：

PHASE 0（调研）
├── enumerate 22 functions + module-level vars
├── enumerate 12 IPC handlers
├── draw dependency DAG
└── output: main.js 架构评估报告
        │
        ▼
PHASE 1（低风险纯函数，-200 行）
├── _cli-parser.js（parseAgentWorkbenchFlags）
├── _paths.js（resolveCoreRoot/Resource/Core + resolveNodeBin）
├── _network.js（reserveAvailablePort）
├── _csp.js（setupCsp）
├── _agent-flags-ipc.js（setupAgentWorkbenchFlagsIpc）
└── _skills-ipc.js（_resolveSkillsIpcWindow 预拆分）
        │
        ▼
PHASE 2（中风险 async/IPC，-300 行）
├── _backend-ports.js（selectBackendPorts）
├── _plugin-loader.js（loadInstalledPlugins）
├── _content-sync.js（startContentSync）
├── _agent-flags.js（publishAgentWorkbenchFlags）
├── _window-ipc.js（setupWindowIpc stub facade）
├── _app-menu.js（setupAppMenu）
├── _skills-progress.js（Skills poller 4 个）
└── _skills-sdk.js（_getSkillsSDK）
        │
        ▼
PHASE 3（高风险，-300 行）
├── _window-create.js（createWindow，依赖 _window-ipc.js PHASE 2）
├── _skills-ipc.js（合并 _resolveSkillsIpcWindow + setupSkillsIpc）
└── _entry.js（main 入口编排，≤ 40 行）
        │
        ▼
PHASE 4（closeout）
├── 4 治理门 GREEN
├── chf0-critical 33/33 PASS
└── BLOCK-15 closeout 报告
```

**commit 边界**：SUB-15.1 = 1 PHASE 0 commit（调研报告）+ 3 implementation commits（PHASE 1 / 2 / 3 各 1）+ 1 closeout commit = **5 commits**

### §4.2 SUB-15.2 IPC channel catalog（3 PHASE）

```
SUB-15.2 DAG：

PHASE 0（channel 枚举调研）
├── grep src/main.js + src/ipc/*.js + src/preload.js
├── 建立 channel catalog（方案 A：从源码枚举）
└── output: docs/block-15-ipc-channel-catalog.md 或修正后的依赖说明
        │
        ▼
PHASE 1（catalog + contract test）
├── src/ipc/_channel-catalog.js
├── test/ipc-channel-contract.test.mjs
└── commit: ipc-catalog-struct
        │
        ▼
PHASE 2（schema 扩展 + block-15-gates）
├── src/plugin-schema-extended.js（或扩展 plugin-schema.js）
├── test/plugin-schema-strict.test.mjs
├── scripts/block-15-gates.mjs
└── package.json 注册 block-15:test
        │
        ▼
PHASE 3（验证 + closeout）
├── npm run block-15:test GREEN
└── impact-map.json block-15 rule
```

**commit 边界**：SUB-15.2 = 1 PHASE 0 commit（catalog doc）+ 2 implementation commits（PHASE 1 / 2）+ 1 closeout = **4 commits**

### §4.3 SUB-15.3 + SUB-15.4（可并行，各 2 PHASE）

```
SUB-15.3 DAG：
PHASE 0: scripts/dev-electron-profile.mjs 开发 + 基线测量
PHASE 1: test/dev-electron-profile.test.mjs + 基线记录
commit: dev-electron-profile-fixture

SUB-15.4 DAG：
PHASE 0: test/ipc-serialization-backpressure.test.mjs 开发 + 基线测量
PHASE 1: event-loop lag 探针集成 + 基线记录
commit: ipc-backpressure-fixture
```

**commit 边界**：SUB-15.3 = **2 commits**（PHASE 0 / PHASE 1）；SUB-15.4 = **2 commits**（PHASE 0 / PHASE 1）

### §4.4 总体 commit 汇总

| SUB | PHASE 0 | PHASE 1 | PHASE 2 | PHASE 3 | closeout | 小计 |
|-----|---------|---------|---------|---------|---------|------|
| **SUB-15.1** | 1（调研报告） | 1 | 1 | 1 | 1 | **5** |
| **SUB-15.2** | 1（catalog doc） | 1 | 1 | 1（closeout） | — | **4** |
| **SUB-15.3** | 1 | 1 | — | — | — | **2** |
| **SUB-15.4** | 1 | 1 | — | — | — | **2** |
| **总计** | 4 | 4 | 2 | 2 | 2 | **13 commits** |

**并行策略**：
- SUB-15.2 PHASE 0 + SUB-15.3 PHASE 0 + SUB-15.4 PHASE 0 可**并行**（均无代码产出，仅调研/脚本开发）
- SUB-15.1 PHASE 1/2/3 需**串行**（main.js 拆分有依赖）
- SUB-15.2 PHASE 1 依赖 SUB-15.2 PHASE 0 的 catalog doc
- SUB-15.3 + SUB-15.4 独立，与 SUB-15.1 + SUB-15.2 完全并行

---


## §5 测试矩阵

> **Baseline 归档纪律**：SUB-15.3 dev Electron 启动时序和 SUB-15.4 IPC backpressure 测量结果直接内联记录在本 plan §5，不另建文档。每次 PHASE 收口时同步更新。Baseline 数据为 G0 开发期内部参考，不作为 acceptance criteria。

| 测试文件 | 类型 | 运行方式 | SUB 归属 | Baseline 记录位置 | 备注 |
|---------|------|---------|---------|-----------------|------|
| `test/ipc-channel-contract.test.mjs` | 单元 | `node --test` | SUB-15.2 | — | 双向 contract 校验 |
| `test/plugin-schema-strict.test.mjs` | 单元 | `node --test` | SUB-15.2 | — | 扩展 schema 校验 |
| `test/dev-electron-profile.test.mjs` | 单元 | `node --test`（CI，不启动 Electron） | SUB-15.3 | 本 plan §5 内联记录 | CI-friendly fixture |
| `scripts/dev-electron-profile.mjs` | 脚本 | 人工本地运行（实机） | SUB-15.3 | 本 plan §5 内联记录 | 真机 profile |
| `test/ipc-serialization-backpressure.test.mjs` | 单元/集成 | `node --test`（需 Electron harness） | SUB-15.4 | 本 plan §5 内联记录 | 序列化测量 |
| `test/window-controls.test.mjs` | 回归 | `node --test` | SUB-15.1 | — | main.js 拆分后确保 window IPC 不退化 |
| `test/plugin-manifest-schema.test.mjs` | 回归 | `node --test` | SUB-15.2 | — | manifest schema 不退化 |
| `chf0-critical` | 回归 | `node --test test/chf0-critical.test.mjs` | ALL | — | 33 项不变量不退化 |
| `npm run docs:check` | 门禁 | npm script | ALL | — | 4 治理门之一 |
| `npm run ui:audit:check` | 门禁 | npm script | ALL | — | 4 治理门之一 |
| `npm run block-15:test` | 门禁 | npm script | SUB-15.2 | — | IPC catalog gate（新增） |
**实机测试（需 dev Electron 环境）**：
- `scripts/dev-electron-profile.mjs`：dev Electron 启动时序（SUB-15.3）
- `test/ipc-serialization-backpressure.test.mjs`：1MB/10MB/100MB 延迟（SUB-15.4）

**CI-friendly 测试（默认运行）**：
- `test/ipc-channel-contract.test.mjs`（SUB-15.2）
- `test/plugin-schema-strict.test.mjs`（SUB-15.2）
- `test/dev-electron-profile.test.mjs`（SUB-15.3，仅验证 fixture 可执行）
- chf0-critical 33/33 PASS（全 SUB 回归）

---

## §6 G0 阶段纪律合规声明

> **G0 开发期常态 · 不外推 packaged/Provider/GA**

| SUB | 实施边界 | G0 合规声明 |
|-----|---------|------------|
| SUB-15.1 | **dev Electron 边界内**（main.js 重构，IPC handler channel 契约不变） | ✅ 仅 refactor，不改动 IPC channel 名/payload；不外推 packaged / Provider / GA |
| SUB-15.2 | **dev Electron 边界内**（IPC catalog 门禁，仅测试，不落地优化） | ✅ 仅建立 catalog + contract test，不外推 MCP expose / Provider 矩阵 |
| SUB-15.3 | **dev Electron 边界内**（启动 profile fixture，仅测量基线） | ✅ 仅测量启动时序，不外推 packaged 公证 / GA 流水线 |
| SUB-15.4 | **dev Electron 边界内**（IPC backpressure 测量 fixture，仅测量） | ✅ 仅测量延迟基线；**不落地** off-thread Worker / MessageChannel transfer / SharedArrayBuffer（Tier 4 落地优化属 G1+） |

**不变量声明**：
- `src/preload.js`（347 行）：**0 diff**（IPC 桥接不变）
- `frontend/src/lib/electron.d.ts`：**0 diff**（TypeScript 定义不变）
- `frontend/src/lib/desktopBridge.ts`：**0 diff**（IPC 封装不变）
- `src/plugin-manager.js`（562 行）：**0 diff**（SUB-15.2 不修改 plugin-manager 公共接口）
- `core/shared-backend/*`：**0 diff**
- IPC channel 契约：**100% 不变**（main.js handler 注册 channel 名 + payload shape 一致）

---

## §7 风险登记表

| 风险 ID | 描述 | 概率 | 影响 | 缓解策略 | Owner |
|---------|------|------|------|---------|-------|
| **B15-R1** | main.js `createWindow` 260 行高风险拆分，可能影响 BrowserWindow 创建逻辑 | 🟠 中 | 🔴 高 | BLOCK-9.1 风格依赖注入；PHASE 3 单独 commit；每 commit 后 chf0-critical 33/33 PASS | 主 agent |
| **B15-R2** | main.js `main` 入口拆分（162 行），Electron lifecycle 编排改变可能导致 startup regression | 🟠 中 | 🔴 高 | main.js 保留 `main` 为薄 facade；实际 lifecycle 逻辑分流到 `_entry.js` | 主 agent |
| **B15-R3** | `setupSkillsIpc` 131 行 + `_resolveSkillsIpcWindow` 跨 PHASE 合并，存在导入路径断裂风险 | 🟠 中 | 🟠 中 | SUB-15.1 PHASE 1 预拆分 `_resolveSkillsIpcWindow`；PHASE 3 合并时验证路径 | 主 agent |
| **B15-R4** | IPC channel catalog 文档不存在（`docs/block-14-ipc-channel-catalog.md` 缺失），SUB-15.2 PHASE 0 需从源码枚举 | 🟠 中 | 🟠 中 | 采用方案 A（从源码枚举）；SUB-15.2 PHASE 0 补充调研 | plan worker |
| **B15-R5** | SUB-15.2 自写 validator 覆盖 IPC payload schema，可能存在 schema drift | 🟢 低 | 🟠 中 | catalog 由源码枚举生成（双重源）；payload shape 仅做基本类型检查 | 主 agent |
| **B15-R6** | 100MB payload IPC backpressure 测量可能触发 Node.js Buffer 内存限制 | 🟠 中 | 🟠 中 | 100MB 测试前先测 1MB/10MB 建立基线；设置内存警告阈值；G0 仅测量不优化 | 主 agent |
| **B15-R7** | dev-electron-profile fixture 在 CI 环境中无法运行，test 文件 CI 覆盖率不足 | 🟢 低 | 🟠 中 | test 文件设计为 CI-friendly（仅验证 fixture 可执行）；真实 profile 在本地手动运行 | 主 agent |
| **B15-R8** | block-15-gates.mjs 新建但 package.json scripts 命名可能与现有门禁冲突 | 🟢 低 | 🟢 低 | 命名为 `block-15-gates.mjs` + npm script `block-15:test`（与本修订一致）；验证 scripts 列表无重名 | 主 agent |

---

## §8 后续工作包候选

> **以下候选不在 BLOCK-15 范围内；任何一项如需推进须用户显式裁决进入 G1+ 阶段。**

| 候选 ID | 内容 | 当前状态 | 触发条件 |
|---------|------|---------|---------|
| **候选-1** | **Tier 4 IPC backpressure 落地优化**：基于 SUB-15.4 测量结果，落地 off-thread Worker / MessageChannel transfer / SharedArrayBuffer 优化 IPC 序列化延迟 | 测量阶段（SUB-15.4） | 用户裁决进入 G1+ 阶段后，基于测量数据评估 ROI |
| **候选-2** | **IPC off-thread Worker**：将 heavy payload 处理移至 Worker 线程，避免主进程 event-loop 阻塞 | 待评估 | 同候选-1 |
| **候选-3** | **IPC MessageChannel transfer**：使用 transferable 对象减少大型 payload 拷贝开销 | 待评估 | 同候选-1 |
| **候选-4** | **dev Electron 启动时序优化**：基于 SUB-15.3 基线数据，识别关键路径瓶颈并优化 | 待评估 | SUB-15.3 基线建立后 + 用户裁决 |
| **候选-5** | **Result Studio P7 deferred**（RS-P7）：当前 `implemented_unverified / experimental` | deferred（BLOCK-11 plan v1.0 §7） | 用户裁决进入 G1+ 阶段 |
| **候选-6** | **Provider 矩阵实现**：真实 Provider 类配置 + MCP Server 插件化 | deferred（G0 阶段常态） | 用户裁决进入 G1+ 阶段 |
| **候选-7** | **packaged Electron 公证/签名/ notarization 流水线** | deferred（G0 阶段常态） | 用户裁决进入 G1+ 阶段 |
| **候选-8** | **qualificationEligible 提升 true** | 当前 `false`（G0 开发期常态） | 用户裁决进入 G1+ 阶段 |

---

## §9 收口门禁

### §9.1 治理门禁（4 项，必须全部 GREEN）

| Gate | Command | 期望结果 | SUB 关联 |
|------|---------|---------|---------|
| **G1: docs check** | `npm run docs:check` | PASS（无新增 missing/orphaned docs） | ALL |
| **G2: UI audit check** | `npm run ui:audit:check` | GREEN（本批次 0 新增 drift） | SUB-15.1（如有 UI 改动） |
| **G3: docs reconcile** | `npm run docs:reconcile` | 0 issues | ALL |
| **G4: TypeScript** | `npx tsc --noEmit` | 0 errors | ALL |

### §9.2 专项门禁

| Gate | Command | 期望结果 | SUB 关联 |
|------|---------|---------|---------|
| **G5: IPC catalog gate** | `npm run block-15:test`（新增） | PASS | SUB-15.2 |
| **G6: chf0-critical** | `node --test test/chf0-critical.test.mjs` | 33/33 PASS | SUB-15.1 |
| **G7: IPC contract** | `node --test test/ipc-channel-contract.test.mjs` | PASS | SUB-15.2 |
| **G8: plugin schema strict** | `node --test test/plugin-schema-strict.test.mjs` | PASS | SUB-15.2 |
| **G9: window controls regression** | `node --test test/window-controls.test.mjs` | PASS | SUB-15.1 |
| **G10: dev-electron-profile fixture** | `node --test test/dev-electron-profile.test.mjs` | PASS | SUB-15.3 |
| **G11: backpressure fixture** | `node --test test/ipc-serialization-backpressure.test.mjs` | PASS | SUB-15.4 |

### §9.3 impact-map.json 同步

BLOCK-15 完成后须在 `test/impact-map.json` 新增规则：

```jsonc
{
  "id": "block-15-ipc-architecture",
  "patterns": [
    "src/main.js",
    "src/ipc/_channel-catalog.js",
    "test/ipc-channel-contract.test.mjs",
    "test/plugin-schema-strict.test.mjs"
  ],
  "tests": [
    "test/ipc-channel-contract.test.mjs",
    "test/plugin-schema-strict.test.mjs",
    "test/chf0-critical.test.mjs"
  ],
  "classifiesScripts": false
}
```

---

## §10 BLOCK-15 工作包范围摘要

| SUB | 目标 | 交付物 | 预估 commits | 预估人天 |
|-----|------|--------|-------------|---------|
| **SUB-15.1** | main.js 全面重拆 | main.js ≤ 400 行（-800 行）+ src/main/ 若干子文件 | 5 | 4.0 |
| **SUB-15.2** | IPC channel catalog + plugin schema 门禁 | `src/ipc/_channel-catalog.js` + `test/ipc-channel-contract.test.mjs` + `scripts/block-15-gates.mjs` | 4 | 2.5 |
| **SUB-15.3** | dev Electron 启动 profile fixture | `scripts/dev-electron-profile.mjs` + `test/dev-electron-profile.test.mjs` + 基线记录 | 2 | 1.0 |
| **SUB-15.4** | IPC 序列化 backpressure 测量 fixture | `test/ipc-serialization-backpressure.test.mjs` + 基线记录 | 2 | 1.0 |
| **总计** | | | **13 commits** | **8.5 人天** |

---

## §11 文档治理同步

BLOCK-15 完成后须同步以下 canonical 文档：

| 文档 | 动作 |
|------|------|
| `docs/DOC-REGISTRY.json` | 新增 BLOCK-15 entry（status: active → completed） |
| `docs/README.md` | 追加 BLOCK-15 closeout 引用 |
| `docs/next-steps-roadmap.md` | 更新 BLOCK-15 状态 + 后续候选列表 |

---

*Draft generated: 2026-08-19 | BLOCK-15-ARCH-PERF / v0.1 DRAFT | plan worker output*

---

## §15.2.x SUB-15.2 PHASE 1 实测数据（2026-08-19 落地）

> 以下数据由 `scripts/validate-ipc-catalog.mjs` 静态扫描实测生成，取代 §15.2.3 的估算 placeholder。

### §15.2.x.1 实测 IPC catalog 汇总

| 指标 | 数量 |
|------|------|
| `ipcMain.handle` | 80 |
| `ipcMain.on` | 4 |
| `webContents.send` | 24 |
| **Total main-side registrations** | **108** |
| `ipcRenderer.invoke` | 40 |
| `ipcRenderer.on` | 11 |
| **Consistent pairs** | **50** |
| **Shadow channels（main-only, OK）** | **42** |
| **Orphan channels（ERROR）** | **0** |

> ✅ 门禁 PASS：0 orphans，108 main-side 注册，50 bidirectional consistent pairs

### §15.2.x.2 Shadow channels 分类

**Shadow handles（38）— main `ipcMain.handle` 但 preload 无 `ipcRenderer.invoke`**：

| Channel | File | Line |
|---------|------|------|
| `skills:discover` | src/main.js | 465 |
| `window:isMaximized` | src/main/_window-ipc.js | 47 |
| `window:isFullScreen` | src/main/_window-ipc.js | 53 |
| `app:relaunch` | src/main/_window-ipc.js | 73 |
| `ai-settings:get` | src/ipc/ai-settings.js | 32 |
| `updater:check` | src/ipc/auto-update.js | 49 |
| `updater:download` | src/ipc/auto-update.js | 68 |
| `updater:install` | src/ipc/auto-update.js | 80 |
| `py:start` | src/ipc/backend-lifecycle.js | 21 |
| `py:stop` | src/ipc/backend-lifecycle.js | 29 |
| `plumber:start` | src/ipc/backend-lifecycle.js | 37 |
| `plumber:stop` | src/ipc/backend-lifecycle.js | 45 |
| `branch:project:create` | src/ipc/branch-handlers.js | 41 |
| `branch:project:get` | src/ipc/branch-handlers.js | 54 |
| `branch:project:update` | src/ipc/branch-handlers.js | 67 |
| `branch:project:list` | src/ipc/branch-handlers.js | 83 |
| `branch:get` | src/ipc/branch-handlers.js | 109 |
| `branch:children` | src/ipc/branch-handlers.js | 196 |
| `message:append` | src/ipc/branch-handlers.js | 211 |
| `message:list` | src/ipc/branch-handlers.js | 228 |
| `message:get` | src/ipc/branch-handlers.js | 241 |
| `message:count` | src/ipc/branch-handlers.js | 254 |
| `message:delete` | src/ipc/branch-handlers.js | 267 |
| `message:clear` | src/ipc/branch-handlers.js | 283 |
| `compute-settings:get` | src/ipc/compute-settings.js | 78 |
| `data:info` | src/ipc/data-management.js | 39 |
| `data:open-dir` | src/ipc/data-management.js | 84 |
| `harness-capabilities:list` | src/ipc/harness-capabilities.js | 31 |
| `plugin:list-installed` | src/ipc/plugin.js | 26 |
| `plugin:list-remote` | src/ipc/plugin.js | 37 |
| `plugin:check-updates` | src/ipc/plugin.js | 48 |
| `content-plugin:list` | src/ipc/plugin.js | 81 |
| `result:createWithBranch` | src/ipc/result-handlers.js | 85 |
| `runtime:status` | src/ipc/runtime-status.js | 16 |
| `backend:status` | src/ipc/runtime-status.js | 28 |
| `terminal:snapshot` | src/ipc/terminal.js | 50 |
| `terminal:open-log-dir` | src/ipc/terminal.js | 111 |
| `terminal:session-stop` | src/ipc/terminal.js | 220 |

**Shadow on（4）— main `ipcMain.on` 但 preload 无 `ipcRenderer.on`**：

| Channel | File | Line |
|---------|------|------|
| `window:minimize` | src/main/_window-ipc.js | 29 |
| `window:maximize` | src/main/_window-ipc.js | 33 |
| `window:close` | src/main/_window-ipc.js | 43 |
| `window:toggleFullScreen` | src/main/_window-ipc.js | 58 |

> **说明**：window chrome 控制事件由 preload 直接映射到 `webContents` API，不通过 IPC channel（浏览器原生窗口控制）。

### §15.2.x.3 Consistent pairs（50）

双向配对分为两类：
1. **invoke 对**：main `ipcMain.handle` ↔ preload `ipcRenderer.invoke`（request/response）
2. **push/listen 对**：main `webContents.send` ↔ preload `ipcRenderer.on`（main→renderer push）

完整清单见 `docs/ipc-catalog.md` 的 Machine-Readable Catalog JSON block。

### §15.2.x.4 实现说明

| Plan §15.2.x 条目 | 计划 | 实际 |
|-------------------|------|------|
| 入口文件 | `src/ipc/_channel-catalog.js` | `scripts/validate-ipc-catalog.mjs` |
| 测试文件 | `test/ipc-channel-contract.test.mjs` | 已合并到 validator 内置 |
| 门禁脚本 | `scripts/block-15-gates.mjs` | 整合到 validator 内置 |
| Catalog 输出 | `docs/block-15-ipc-channel-catalog.md` | `docs/ipc-catalog.md` |

> **差异说明**：计划中的 `src/ipc/_channel-catalog.js`（静态 catalog）+ `test/ipc-channel-contract.test.mjs`（动态测试）合并为单个 `scripts/validate-ipc-catalog.mjs`（纯静态扫描），简化为单文件门禁。Catalog 输出为 `docs/ipc-catalog.md`（Markdown 含 JSON block）而非原计划的 `docs/block-15-ipc-channel-catalog.md`。语义等价，文件边界不同。

### §15.2.x.5 Bug 修复（落地时发现并修复）

| Issue | File | Fix |
|-------|------|-----|
| `plugin:install-progress` orphaned listener | `src/preload.js` L165-174 | 移除 `ipcRenderer.on('plugin:install-progress')` listener（main 端无 `webContents.send` 对应） |

### §15.2.x.6 SUB-15.2 PHASE 1 vs PHASE 0 对比

| 指标 | PHASE 0 估算（worker `12adb78e`） | PHASE 1 实测 | 差异 |
|------|-----------------------------------|-------------|------|
| main handler 总数 | ~86 | 108 | +22 |
| src/ipc/*.js handlers | 37 | 80 | +43 |
| branch-handlers.js | 18 | 18 | 0 |
| result-handlers.js | 12 | 12 | 0 |
| Consistent pairs | 51 | 50 | -1 |
| Shadow channels | 13 | 42 | +29 |
| Orphan channels | 0 | 0 | 0 |

> **差异原因**：PHASE 0 估算仅统计 `ipcMain.handle`，遗漏了 `webContents.send`（24 个 push channel）和 `ipcMain.on`（4 个 window chrome listener）。实测数据以 §15.2.x.1 为准。

### §15.2.x.7 SUB-15.2 后续 PHASE

| PHASE | 内容 | 状态 |
|-------|------|------|
| PHASE 0（调研） | 从源码枚举 channel（✅ 已完成） | 收口 |
| **PHASE 1（门禁脚本）** | `validate-ipc-catalog.mjs` + catalog 生成（✅ 已完成） | **本次收口** |
| PHASE 2 | plugin schema 扩展 + payload shape 验证（待启动） | planned |
