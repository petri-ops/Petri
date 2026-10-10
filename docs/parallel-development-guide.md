# Petri Desktop 并行开发指南

> 本文档规范多模块并行开发的冲突风险管控策略。  
> **核心原则**：独立模块大胆并行，跨层接口变更必须串行合并。

---

## 1. 项目模块划分

Petri Desktop 采用**多进程架构**，分为以下 5 大模块：

| 模块 | 技术栈 | 代码路径 | 职责定位 |
|------|--------|----------|----------|
| **Electron 主进程** | Electron + Node.js (CJS) | `src/` | 桌面壳：窗口管理、子进程生命周期、应用启动 |
| **React 前端** | React 18 + Vite + TypeScript | `frontend/src/` | 渲染进程：UI 界面、用户交互 |
| **R Server** | Node.js (CJS) + R runtime | `core/r-server/` | 分析引擎：R 脚本执行、科学计算、数据库 |
| **Python Server** | Node.js (CJS) + Python runtime | `core/py-server/` | 分析引擎：Python 脚本执行、工具路由 |
| **Shared Backend** | Node.js (CJS) | `core/shared-backend/` | 纯逻辑层：Result Studio、Git 适配器、循环控制器、AI 任务编排 |

另有辅助层级：
- **Gateway** (`core/gateway/`)：统一入口、路由分发、断路器
- **Shared Copilot** (`core/packages/shared-copilot/`)：前端共享组件包

---

## 2. 模块依赖关系图

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         Electron 主进程 (src/main.js)                     │
│                    负责启动所有子进程、加载插件、管理窗口                    │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │ spawn() 子进程
           ┌───────────────────────┼───────────────────────┐
           │                       │                       │
           ▼                       ▼                       ▼
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│    R Server      │   │  Python Server   │   │   React 前端     │
│ (core/r-server)  │   │ (core/py-server) │   │ (frontend/src/)  │
│                  │   │                  │   │                  │
│ - agent-runner   │   │ - 工具路由       │   │ - UI 组件        │
│ - db.js         │   │ - Python 脚本    │   │ - 状态管理       │
│ - agent-tools/  │   │                  │   │ - 路由           │
└────────┬─────────┘   └────────┬─────────┘   └────────┬─────────┘
         │                       │                       │
         │    HTTP API          │                       │ IPC
         └───────────┬───────────┘                       │
                     │                                   │
                     ▼                                   ▼
         ┌───────────────────────┐           ┌──────────────────────────┐
         │       Gateway         │◄──────────│    desktopBridge.ts      │
         │   (core/gateway/)     │           │    (IPC 桥接封装)         │
         └───────────┬───────────┘           └──────────────────────────┘
                     │
                     ▼
         ┌──────────────────────────────────────────────────────────────┐
         │                     Shared Backend                             │
         │                     (core/shared-backend/)                      │
         │  - Result Studio (result-studio-*.js)                         │
         │  - Loop Controller (loop-*.js)                                 │
         │  - Git Adapter (git-*.js)                                      │
         │  - Scientific Task (scientific-task-*.js)                     │
         │  - Agent Workflow (agent-workflow.js)                         │
         └──────────────────────────────────────────────────────────────┘
```

---

## 3. 通信方式总结

| 通信路径 | 方式 | 耦合度 | 说明 |
|----------|------|--------|------|
| main.js → r-server | `spawn()` 子进程 | **低** | 进程隔离，V8 版本不冲突 |
| main.js → py-server | `spawn()` 子进程 | **低** | 进程隔离 |
| main.js → frontend | `BrowserWindow` | **低** | WebView 沙箱 |
| frontend → r-server | HTTP (localhost:3003) | **低** | 通过 Gateway 调用 |
| frontend → py-server | HTTP (localhost:3004) | **低** | 通过 Gateway 调用 |
| r-server → shared-backend | `require()` | **中** | 共享逻辑依赖 |
| py-server → shared-backend | `require()` | **中** | 共享逻辑依赖 |
| frontend → shared-copilot | `import` npm 包 | **低** | 标准模块导入 |

---

## 4. 并行开发冲突风险矩阵

### 4.1 风险等级定义

| 等级 | 颜色 | 含义 | 策略 |
|------|------|------|------|
| 🟢 **低风险** | 绿色 | 模块完全独立，可大胆并行 | 各自开发，通过 CI 集成 |
| 🟡 **中风险** | 黄色 | 存在接口依赖，需协调 | 先约定接口，后各自开发 |
| 🔴 **高风险** | 红色 | 高度耦合，禁止并行 | 必须串行，同一 MR 合并 |

### 4.2 模块组合风险矩阵

| 模块 A | 模块 B | 风险 | 策略 |
|--------|--------|------|------|
| frontend | r-server | 🟢 低 | 可并行，通过 HTTP API 解耦 |
| frontend | py-server | 🟢 低 | 可并行，通过 HTTP API 解耦 |
| frontend | shared-backend (纯函数) | 🟢 低 | 可并行，不涉及跨层调用 |
| r-server | py-server | 🟢 低 | 可并行，各自独立进程 |
| r-server | shared-backend | 🟡 中 | shared-backend API 变更需适配 |
| py-server | shared-backend | 🟡 中 | shared-backend API 变更需适配 |
| frontend | shared-copilot | 🟡 中 | 包版本升级需协调 |
| main.js | 其他所有 | 🟡 中 | spawn 逻辑变更可能影响其他模块 |
| frontend | desktopBridge/electron.d.ts | 🟡 中 | 类型定义需同步变更 |
| r-server MCP registry | 前端 tool 调用 | 🟡 中 | API 契约变更需同步 |
| shared-backend 内部 | shared-backend 内部 | 🔴 高 | 子模块高度互依，禁止并行 |
| desktopBridge.ts | electron.d.ts | 🔴 高 | 类型漂移风险，同一 MR 合并 |
| shared-backend index.js | r-server plugin-loader | 🔴 高 | Barrel 导出变更，同一 MR 合并 |
| Result Studio 跨 3 层 | - | 🔴 高 | 涉及 shared-backend + r-server + frontend |

---

## 5. 并行开发规范

### 5.1 🟢 低风险场景（可大胆并行）

以下场景模块完全独立，可放心并行开发：

- ✅ frontend UI 开发（只需 mock 后端 API）
- ✅ r-server 分析脚本开发（测试时启动 Gateway 即可）
- ✅ py-server 工具路由开发（独立 HTTP 调用）
- ✅ shared-backend 纯函数逻辑（不涉及外部依赖的子模块）
- ✅ Gateway 断路器/重试逻辑（独立 HTTP 封装层）

### 5.2 🟡 中风险场景（需协调策略）

| 场景 | 协调流程 |
|------|----------|
| frontend ↔ r-server 新增 API | 1. 在 `core/shared-backend/` 定义接口契约 2. 前端后端各自实现 3. 集成测试验证 |
| shared-backend 功能扩展 | 1. 评估影响范围 2. 如影响 r-server/py-server，先发 RFC 3. 接口版本化 |
| main.js 启动逻辑变更 | 1. 评估影响模块 2. 在同一 MR 中包含所有受影响模块的适配代码 |

### 5.3 🔴 高风险场景（禁止并行）

| 场景 | 原因 | 解决方案 |
|------|------|----------|
| `desktopBridge.ts` ↔ `electron.d.ts` | 类型定义漂移 | 合并为单一 MR，同步修改 |
| `shared-backend/index.js` ↔ r-server plugin-loader | Barrel 导出变更 | 使用 feature flag 或接口版本化 |
| Result Studio 跨 3 层功能 | 涉及 100+ 文件 | 建立专项工作包，统一开发 |

---

## 6. 跨层修改 RFC 流程

当修改涉及以下情况时，必须启动 RFC（Request for Comments）流程：

### 6.1 触发条件

- 修改 `desktopBridge.ts` 或 `electron.d.ts`
- 修改 `shared-backend/index.js` 的导出
- 新增或修改 r-server MCP 工具的 schema
- 修改 main.js 的子进程启动逻辑
- 修改影响前端共享类型的接口契约

### 6.2 RFC 流程

```
1. 发起 RFC
   └── 在 docs/rfc/ 下创建 RFC-XXX-<功能名>.md
   
2. 描述变更
   └── 影响范围（哪些模块受影响）
   └── 新旧接口对比
   └── 迁移策略
   
3. 评审
   └── 相关模块负责人确认
   └── 至少 2 人 approve
   
4. 实施
   └── 所有受影响模块在同一 MR 中修改
   └── 包含完整的集成测试
   
5. 验证
   └── CI 通过
   └── 人工验收（如需要）
```

---

## 7. Git 工作流建议

### 7.1 分支命名规范

```bash
# 独立模块开发
feature/frontend-<功能名>
feature/rserver-<功能名>
feature/pyserver-<功能名>

# 跨层功能开发（需合并）
feature/cross-<功能名>-frontend  # 先完成前端部分
feature/cross-<功能名>-backend   # 再完成后端部分
# 两者最终合并到同一 PR

# 共享层变更
feature/shared-<功能名>
```

### 7.2 PR 合并策略

| 场景 | 策略 |
|------|------|
| 独立模块 PR | 直接合并，CI 通过即可 |
| 跨层接口 PR | 所有相关模块 MR 同时提，同时合 |
| main.js 变更 | 必须包含受影响模块的适配代码 |

---

## 8. 常见耦合点清单

以下文件变更时需特别注意同步：

| 文件 | 耦合文件 | 同步要求 |
|------|----------|----------|
| `frontend/src/lib/electron.d.ts` | `frontend/src/lib/desktopBridge.ts` | 必须同步修改 |
| `frontend/src/lib/desktopBridge.ts` | `src/preload.js` | 必须同步修改 |
| `core/r-server/mcp/registry.js` | `src/mcp-server.js` | 必须同步修改 |
| `core/shared-backend/index.js` | r-server plugin-loader | 评估影响后决定 |
| `core/shared-backend/*.js` | r-server/py-server 调用方 | 必须适配 |

---

## 9. 快速检查清单

开发前快速评估：

- [ ] 本次修改涉及哪些模块？
- [ ] 涉及模块之间的接口/类型定义吗？
- [ ] 是否有其他人在修改同一个模块？
- [ ] 如果有并行，是否符合上述风险矩阵？

**答案查询**：
- 🟢 低风险 → 大胆并行
- 🟡 中风险 → 接口先行，通知相关人
- 🔴 高风险 → 串行开发，合并 MR

---

## 10. 附录：术语表

| 术语 | 说明 |
|------|------|
| **RFC** | Request for Comments，变更评审流程 |
| **Barrel** | index.js 统一导出文件 |
| **desktopBridge** | Electron IPC 桥接封装 |
| **Gateway** | 统一入口层，处理路由和断路 |
| **spawn** | Node.js child_process 子进程创建 |

---

*本文档由架构分析自动生成，最后更新：2026-08-14*
