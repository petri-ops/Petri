# Stage 3 M1 Capability Provisioning 审计报告

> **吸收声明**（2026-08-16 GATES-4 batch 2）：本审计为 Stage 3 收口前的只读审计；Stage 3 已收口（详见 [`ui-productization-audit.md`](../../ui-productization-audit.md) Stage 3 段）；本文件保留为追溯。


> 审计类型：**只读代码审计**（不改动任何代码）
> 审计日期：2026-07-17
> 审计对象：工作区未提交的 Stage 3 M1 代码
> 审计结论：**代码质量良好，13 个测试全通过，不变量全部遵守。3 条建议级改进 + 1 条安全建议。**

---

## 一、审计范围

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `core/shared-backend/capability-provisioning.js` | 新增 | 核心模块：能力预备 CRUD + SHA-256 校验 + 幂等 |
| `test/capability-provisioning.test.mjs` | 新增 | 13 个测试，全通过 |
| `core/shared-backend/index.js` | +1 行 | 注册新模块导出 |
| `core/r-server/helpers/tools-executor.js` | +27/-4 | R_LIBS_USER 注入 provisioned bundle |
| `core/r-server/mcp/registry.js` | +29/-3 | 同上（插件脚本路径） |
| `src/main.js` | +16 | IPC: `harness-capabilities:list`（只读） |
| `src/preload.js` | +5 | 暴露 `harnessCapabilities.list` |
| `frontend/src/lib/electron.d.ts` | +17 | 类型定义 |
| `frontend/src/components/desktop/DesktopSettingsPanel.tsx` | +59 | 设置面板 HarnessEnvironment 只读视图 |
| `scripts/harness-file-index.mjs` | +7/-2 | 索引更新 |
| `docs/ui-productization-audit.md` | 更新 | UI 台账更新 |

---

## 二、不变量核对（设计文档第 2 节）

| 不变量 | 状态 | 核对方式 |
|--------|------|---------|
| 唯一执行事实链未被破坏 | ✅ | `db.js` 未改动，conversation/tool_job/artifact 表 schema 不变 |
| 不新增执行器/job 库/结果系统 | ✅ | capability-provisioning 是 provisioning 层，不是执行器 |
| Electron IPC 经 preload/desktopBridge | ✅ | `harness-capabilities:list` 通过 preload 暴露 |
| 前端 React 本地状态，不引入 zustand | ✅ | HarnessEnvironment 组件用 useState |
| artifact-truth 契约不变 | ✅ | `artifact-truth.js` 未改动 |
| agent-workflow 引擎不变 | ✅ | `agent-workflow.js` 未改动 |
| `api-failover-proxy/` 不进提交 | ✅ | `git ls-files` 确认未跟踪 |

**判定：Stage 3 M1 的所有不变量全部遵守。**

---

## 三、设计约束核对（设计文档 D1-D8）

| 决策 | 状态 | 证据 |
|------|------|------|
| D1 所有功能模块 built-in | ✅ | go-kegg 模块尚未创建（M1 只做地基），built-in-plugins 目录现有 6 个模块 |
| D2 Harness 自备运行时/包，过程无感 | ✅ | capability-provisioning 实现 checkCapabilityReady + provisionCapability |
| D3 预构建 + 模块化 | ✅ | L1/L2/L3 三层模型，requiresBundle 声明 |
| D4 分发源稳定流畅 | ⚠️ 部分 | SHA-256 + version 校验 + 重试 + 幂等已实现；但 host 白名单缺失（见问题 D） |
| D5 离线优先 | ✅ | bundle 预装离线数据，provisioning 先查本地 |
| D6 不硬限物种 | ✅ | capability-provisioning 无物种白名单 |
| D7 分发源沿用 OSS CDN | ✅ | URL 来源为内部 capability 目录 |
| D8 透明进度 | ✅ | IPC 只暴露 list（只读），provision/remove 由编排层内部完成 |

---

## 四、审计发现

### 问题 A：代码重复（R_LIBS_USER 组装逻辑）🟡

- **位置**：`core/r-server/helpers/tools-executor.js:590-615` 和 `core/r-server/mcp/registry.js:475-500`
- **现象**：两处的 R_LIBS_USER 三段式组装逻辑几乎完全相同（约 25 行重复代码）：
  1. provisioned capability bundle lib（requiresBundle）
  2. 插件内置 packages/r
  3. R runtime library
- **建议**：抽取为共享 helper，如 `core/shared-backend/r-libs-resolver.js`，导出 `resolveRLibsForPlugin(pluginCfg)` 函数
- **优先级**：中（不阻塞 M1，但 M2 增加更多 bundle 类型时会重复更多）

### 问题 B：静默 catch {} 吞掉所有错误 🟡

- **位置**：`tools-executor.js:598` 和 `mcp/registry.js:484`
- **现象**：两处 `try { require('capability-provisioning')... } catch {}` 会吞掉所有错误
- **设计意图**：provisioning 未就绪时不阻塞基础执行（正确）
- **建议**：至少 `console.warn` 一次，记录原因。例如：
  ```js
  } catch (e) { console.warn('[harness] capability provisioning unavailable:', e.message); }
  ```
- **优先级**：中

### 问题 C：defaultDownload 未复用 plugin-manager 🟡

- **位置**：`core/shared-backend/capability-provisioning.js` 的 `defaultDownload` 函数
- **现象**：代码注释写"mirrors src/plugin-manager.js#streamingSha256"，是复制而不是复用
- **背景**：设计文档第 3.3 节提到"复用现有管道 plugin-manager.js 的 downloadFile"
- **判定**：可接受的偏离 -- capability-provisioning 有意不依赖 electron（plugin-manager 依赖 electron 的 app.getPath），无法直接复用
- **建议**：M2 阶段评估是否抽取共享下载函数到 shared-backend
- **优先级**：低

### 问题 D：defaultDownload 缺少 host 白名单 🔴→🟡

- **位置**：`core/shared-backend/capability-provisioning.js` 的 `defaultDownload` 函数
- **现象**：defaultDownload 直接 `https.get(options.url)`，无 host 白名单校验
- **设计文档要求**：第 5.5 节明确提到"host 走白名单"；第 3.3 节提到 plugin-manager 的 downloadFile 有 host 白名单
- **当前风险评估**：低 -- M1 阶段 URL 来源是内置 capability 目录（`CAPABILITIES` 常量），非用户直接输入
- **但**：如果后续 capability 来源扩展（如用户自定义源、第三方 manifest），缺少 host 白名单会导致 SSRF 风险
- **建议**：在 defaultDownload 中添加 host 白名单校验，复用 plugin-manager 的 host 白名单逻辑
- **优先级**：中（当前低风险，但应在 M2 扩展分发源前补上）
- **对验收影响**：不阻塞 M1，但应在 M2 前修复

---

## 五、测试门禁状态

```
Node 全量测试：322 tests / 305 pass / 6 fail
  ├─ 5 fail = qa-smoke（已由 fix/qa-smoke-stale-css-paths 分支修复，待主 agent 合并）
  └─ 1 fail = migration CLI（环境问题：better-sqlite3 native module 版本不匹配，
                            需 npm rebuild better-sqlite3，非代码回归）

capability-provisioning 专项测试：13 tests / 13 pass ✅
前端类型检查：tsc --noEmit 通过 ✅
```

---

## 六、审计结论

```
Stage 3 M1 代码就绪度：90%
  ├─ 不变量全部遵守 ✅
  ├─ 设计约束 D1-D8 基本遵守（D4 host 白名单缺失）
  ├─ 13 个测试全通过 ✅
  ├─ 前端类型检查通过 ✅
  └─ 3 条建议级 + 1 条安全建议（均不阻塞 M1）

阻塞级问题：无
建议级问题：4 项（代码重复/静默catch/未复用plugin-manager/host白名单缺失）
```

**对主 agent 的建议**：
1. 问题 D（host 白名单）应在 M2 扩展分发源前修复
2. 问题 A、B 可在 M1 收尾或 M2 开始时处理
3. 问题 C 留到 M2 评估
4. 合并 `fix/qa-smoke-stale-css-paths` 恢复门禁绿色
5. 运行 `npm rebuild better-sqlite3` 修复 migration CLI 测试

---

*本报告由非主 agent 只读审计生成。所有建议项不阻塞 Stage 3 M1。主 agent 可参考本报告决定后续调整。*
