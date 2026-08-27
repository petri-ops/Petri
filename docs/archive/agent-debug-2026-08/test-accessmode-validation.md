# AccessMode 验证测试计划

## 目标
验证只读模式下，破坏性工具调用被正确拦截。

## 测试步骤

### 1. 后端验证测试
后端 `agent-tool-policy.js` 已有完整的 `accessMode` 检查逻辑：
- 第 136-141 行：通用 mutating 操作检查
- 第 183-188 行：`workspace_exec` 特殊检查

需要验证的工具：
- `workspace_write` (sideEffect: 'workspace-write') ✓ 已在 MUTATING_SIDE_EFFECTS
- `workspace_replace` (sideEffect: 'workspace-write') ✓ 已在 MUTATING_SIDE_EFFECTS
- `workspace_exec` (sideEffect: 'execution') ✓ 已在 MUTATING_SIDE_EFFECTS + 特殊检查

### 2. 前端 UI 测试
前端 `SimpleChat.tsx` 已有 `accessMode` 状态管理和切换 UI。

验证点：
- [ ] 切换到"只读模式"后，`accessMode` 状态正确更新为 'read'
- [ ] `accessMode: 'read'` 正确传递到后端 `/api/ai/agent` 请求的 `context` 中
- [ ] 后端收到破坏性工具调用时，返回拒绝响应
- [ ] 前端正确显示拒绝消息

### 3. 端到端测试场景

#### 场景 A：只读模式下尝试写文件
1. 打开 SimpleChat
2. 切换到"只读模式"
3. 发送：`请在项目根目录创建 test-readonly.txt 文件`
4. **预期**：Agent 尝试调用 `workspace_write`，被后端拦截，返回错误消息

#### 场景 B：只读模式下尝试执行命令
1. 打开 SimpleChat
2. 切换到"只读模式"
3. 发送：`请运行 ls -la 命令`
4. **预期**：Agent 尝试调用 `workspace_exec`，被后端拦截，返回错误消息

#### 场景 C：完全访问模式正常工作
1. 打开 SimpleChat
2. 保持"完全访问"模式
3. 发送：`请读取 package.json 文件`
4. **预期**：正常执行 `workspace_read`，返回文件内容

## 实现状态

### 后端
✅ `agent-tool-policy.js` 已有完整逻辑
✅ `workspace_write/replace/exec` 正确分类为 mutating
✅ `ctx.accessMode` 正确传递

### 前端
✅ `SimpleChat.tsx` 已有 `accessMode` 状态和 UI
✅ `useChatStream.ts` 正确传递 `accessMode` 到后端
⚠️ `accessModeValidator.ts` 文件存在但未使用（前端预检查）

## 下一步

1. ✅ 创建本测试计划
2. 🔄 实机测试场景 A、B、C
3. 📝 记录测试结果
4. 🔧 修复发现的问题（如果有）
