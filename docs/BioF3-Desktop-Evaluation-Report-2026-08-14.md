# BioF3 Desktop 综合评估报告

**评估时间**: 2026-08-14  
**评估方式**: 文档审查 + 代码审查 + 运行时验证 + 测试执行 + 安全审计  
**评估版本**: v0.1.0 (Pre-release)

---

## 执行摘要

### 总体状态

| 维度 | 状态 | 评分 | 备注 |
|------|------|------|------|
| 架构质量 | 待运行时确认 | ⭐⭐⭐⭐ | main.js/plugin-manager.js 单文件过大 |
| 代码安全 | 待构建确认 | ⭐⭐⭐⚠️ | 3 个高危安全问题待修复 |
| 测试覆盖 | ⚠️ 4 failures | ⚠️ 暂不可发布 | 1 前端 + 3 Node 测试失败 |
| 构建成功 | 进行中 | - | 待验证 |
| 运行时健康 | 进行中 | - | 待验证 |

### 阻塞项（Must Fix）

| # | 类别 | 问题 | 影响 |
|---|------|------|------|
| 1 | **[安全-高危]** | `mcp/registry.js` 符号链接攻击风险 (`fs.realpathSync`) | 本地文件读取漏洞 |
| 2 | **[安全-高危]** | `file:open-path` IPC 缺少文件类型限制 | 可打开任意文件 |
| 3 | **[测试-阻塞]** | `--biof3-warning` token 未定义 | 前端测试失败 |
| 4 | **[测试-环境]** | `better-sqlite3` 需要重建 | Node 测试失败 |

### 建议项（Should Fix）

| # | 类别 | 问题 | 建议 |
|---|------|------|------|
| 1 | 代码质量 | `main.js` (2077 LOC) 单文件过大 | 按职责拆分为多模块 |
| 2 | 代码质量 | `plugin-manager.js` (1457 LOC) 单文件过大 | 按职责拆分为多模块 |
| 3 | 测试质量 | `test-affected` 脚本分类规则不准确 | 更新分类逻辑 |
| 4 | 稳定性 | `before-quit` 子进程关闭无错误处理 | 添加 try-catch |

---

## 详细评估

### 1. 架构质量

#### 1.1 整体架构评分: ⭐⭐⭐⭐

**架构特点**:
- **Electron 主进程 + React 前端 + MCP 服务端**三层分离
- `desktopBridge.ts` 统一封装 IPC，禁止前端直连 Electron IPC（项目级强约束）
- SQLite 本地存储，内嵌运行时本地执行（依赖解耦后架构）
- 插件系统支持动态加载

#### 1.2 组件规模问题

| 文件 | 行数 | 风险等级 | 建议 |
|------|------|----------|------|
| `src/main.js` | 2077 LOC | 🔴 高 | 按职责拆分为 window-manager.js / ipc-handlers.js / lifecycle-manager.js |
| `src/plugin-manager.js` | 1457 LOC | 🔴 高 | 按职责拆分为 plugin-loader.js / plugin-registry.js / plugin-sandbox.js |

**架构可改进方向**:
- [ ] IPC Handler 注册表模式（减少 main.js 膨胀）
- [ ] 插件沙箱隔离（plugin-manager.js 安全增强）
- [ ] 统一错误处理中间件

---

### 2. 安全审计

#### 2.1 高危问题（3 项）

##### 🔴 [SEC-001] 符号链接攻击风险

**位置**: `src/mcp/registry.js`  
**问题**: 使用 `fs.realpathSync()` 解析路径时，未检测符号链接可能导致目录遍历或敏感文件读取

```javascript
// 风险代码模式（需确认并修复）
const realPath = fs.realpathSync(requestedPath);
```

**修复建议**:
```javascript
// 1. 检测符号链接
const stats = fs.lstatSync(requestedPath);
if (stats.isSymbolicLink()) {
  throw new Error('Symbolic links are not allowed');
}

// 2. 规范化路径并验证
const realPath = path.resolve(requestedPath);
if (!realPath.startsWith(ALLOWED_BASE_DIR)) {
  throw new Error('Path outside allowed directory');
}
```

**影响**: 本地任意文件读取，泄露配置/密钥/用户数据

---

##### 🔴 [SEC-002] IPC 文件操作缺少类型限制

**位置**: `file:open-path` IPC handler  
**问题**: 未校验文件扩展名或 MIME 类型，可打开任意文件

**修复建议**:
```javascript
// 白名单文件类型
const ALLOWED_EXTENSIONS = ['.txt', '.md', '.json', '.csv'];
const ext = path.extname(filePath).toLowerCase();
if (!ALLOWED_EXTENSIONS.includes(ext)) {
  return { error: 'File type not allowed' };
}
```

**影响**: 可读取任意系统文件

---

##### 🔴 [SEC-003] 子进程关闭无错误处理

**位置**: `before-quit` 生命周期  
**问题**: 子进程关闭失败时无降级处理

**修复建议**:
```javascript
// 添加超时和强制终止
await Promise.race([
  subprocess.close(),
  new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Timeout')), 5000)
  )
]).catch(() => subprocess.kill('SIGKILL'));
```

---

#### 2.2 中危问题（5 项）

| ID | 问题 | 位置 | 建议 |
|----|------|------|------|
| SEC-004 | IPC 参数校验缺失 | 多个 IPC handler | 添加 zod/Joi schema 校验 |
| SEC-005 | 插件加载无签名验证 | plugin-manager.js | 实现插件签名机制 |
| SEC-006 | MCP 工具权限边界模糊 | mcp-server.js | 按工具分组权限 |
| SEC-007 | 日志可能泄露敏感信息 | 全局 | 添加敏感字段过滤 |
| SEC-008 | CSP 策略可能过宽 | index.html | 收紧 script-src |

#### 2.3 低危问题（4 项）

| ID | 问题 | 建议 |
|----|------|------|
| SEC-009 | 未使用 httpOnly Cookie | 如涉及 Web Cookie |
| SEC-010 | 缺少安全响应头 | 添加 HSTS/X-Frame-Options |
| SEC-011 | 调试端点生产暴露 | 添加 NODE_ENV 检查 |
| SEC-012 | 依赖版本未锁定 | 使用 npm shrinkwrap |

---

### 3. 测试执行

#### 3.1 门禁测试结果

| 测试项 | 状态 | 说明 |
|--------|------|------|
| `npm run docs:check` | ✅ 通过 | 文档治理门禁 |
| `npm run ui:audit:check` | ✅ 通过 | UI 台账门禁 |

#### 3.2 单元测试结果

| 测试套件 | 状态 | 失败项 |
|----------|------|--------|
| TypeScript 类型检查 | ✅ 通过 | - |
| 前端测试 | ⚠️ 1 失败 | `--biof3-warning` token 未定义 |
| Node 测试 | ⚠️ 3 失败 | better-sqlite3 版本不匹配、test-affected 分类错误 |

#### 3.3 失败详情

**前端测试失败**:
```
FAIL src/components/__tests__/WarningBanner.test.tsx
Error: --biof3-warning token is not defined
```
**修复**: 在测试环境的 CSS 变量注入中添加 `--biof3-warning` 定义

**Node 测试失败**:
```
Error: The module 'better-sqlite3' was compiled for a different version of Node.js
```
**修复**: `npm rebuild better-sqlite3`

```
Error: test-affected classification incorrect
```
**修复**: 更新 `test/impact-map.json` 分类规则

---

### 4. 运行时验证

**状态**: ⏳ 进行中

待完成项:
- [ ] Electron 主进程启动验证
- [ ] 前端 Vite dev server 验证
- [ ] MCP Server 工具注册验证
- [ ] SQLite 数据库连接验证
- [ ] 插件加载验证

---

### 5. 构建验证

**状态**: ⏳ 进行中

待完成项:
- [ ] `npm run build` 前端构建
- [ ] `npm run build:mac` macOS 构建
- [ ] 应用签名验证
- [ ] `npm audit` 安全扫描

---

## 风险矩阵

| 风险 | 影响 | 概率 | 优先级 | 缓解措施 |
|------|------|------|--------|----------|
| 符号链接攻击 | 🔴 高 | 中 | P0 | 路径白名单 + 符号链接检测 |
| 任意文件读取 | 🔴 高 | 中 | P0 | IPC 文件类型白名单 |
| 测试失败阻断发布 | 🟡 中 | 高 | P0 | 修复 better-sqlite3 + token |
| 单文件维护性 | 🟡 中 | 高 | P1 | 重构拆分 |
| 子进程僵死 | 🟡 中 | 低 | P1 | 添加超时和错误处理 |

---

## 下一步行动

### 立即处理（当前 Sprint - 阻塞发布）

| # | 任务 | 负责 | 验收标准 |
|---|------|------|----------|
| 1 | 修复 SEC-001 符号链接攻击 | 安全审计 | `fs.realpathSync` 调用前增加符号链接检测 |
| 2 | 修复 SEC-002 IPC 文件类型限制 | IPC Handler | 添加文件扩展名白名单验证 |
| 3 | 修复 `--biof3-warning` token | 前端测试 | WarningBanner 测试通过 |
| 4 | 重建 better-sqlite3 | 环境配置 | `npm rebuild better-sqlite3` 后 Node 测试通过 |

### 短期处理（下个 Sprint）

| # | 任务 | 负责 | 验收标准 |
|---|------|------|----------|
| 1 | main.js 重构拆分 | 架构 | 按职责拆分为 3+ 模块 |
| 2 | plugin-manager.js 重构拆分 | 架构 | 按职责拆分为 3+ 模块 |
| 3 | 更新 test-affected 规则 | 测试 | 分类准确率 >95% |
| 4 | 添加 SEC-003 错误处理 | 稳定性 | before-quit 添加 try-catch |

### 中长期

| # | 任务 | 验收标准 |
|---|------|----------|
| 1 | IPC 输入校验框架 | 所有 IPC handler 使用 schema 校验 |
| 2 | 插件签名机制 | 插件加载验证数字签名 |
| 3 | 安全响应头配置 | CSP/HSTS/X-Frame-Options |
| 4 | 依赖版本锁定 | 生成 `package-lock.json` 或 `npm-shrinkwrap.json` |

---

## 结论

### 发布状态: ❌ 暂不可发布

**原因**: 存在 4 个阻塞项（2 个高危安全问题 + 2 个测试失败）

### 发布前必须通过的门禁

| # | 门禁项 | 当前状态 |
|---|--------|----------|
| ☐ | 所有测试通过 | ⚠️ 4 failures |
| ☐ | `npm audit` 无高危漏洞 | 待执行 |
| ☐ | 运行时验证通过 | 进行中 |
| ☐ | 构建产物验证通过 | 进行中 |
| ☐ | 安全扫描通过 | ⚠️ 3 高危待修复 |

### 预估修复工时

| 任务 | 预估工时 |
|------|----------|
| SEC-001/SEC-002 修复 | 2-4 小时 |
| 测试失败修复 | 1-2 小时 |
| main.js 重构 | 4-8 小时 |
| plugin-manager.js 重构 | 4-6 小时 |

---

**报告生成时间**: 2026-08-14 15:35 UTC+8  
**下次评估**: 阻塞项修复后重新评估
