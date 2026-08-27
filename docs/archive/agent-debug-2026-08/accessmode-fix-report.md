# AccessMode 修复报告

## 问题根因

**前端 `accessMode` 状态没有正确传递到后端**

### 问题分析

1. **SimpleChat.tsx** 维护了本地的 `accessMode` state（第 230 行）
2. **useChatStream.ts** 在构建 context 时，使用了以下合并顺序：
   ```typescript
   context: {
     ...copilotCtxRef.current,  // 全局 CopilotContext
     ...(contextOverride || {}),
     page: 'desktop-project',
     projectId,
     accessMode,  // 本地 state
   }
   ```
3. **问题**：如果 `copilotCtxRef.current` 中包含 `accessMode` 属性（即使是 `undefined`），由于对象展开顺序，本地的 `accessMode` 会被先写入，然后可能被 `contextOverride` 中的值覆盖
4. **结果**：无论用户如何切换模式，后端始终收到错误的 `accessMode` 值

## 修复方案

### 1. 前端修复（useChatStream.ts）

在两个地方添加了明确的 `accessMode` 覆盖保护：

#### send 函数（第 165-187 行）
```typescript
const contextToSend = {
  ...copilotCtxRef.current,
  ...(contextOverride || {}),
  page: 'desktop-project',
  projectId,
  accessMode,
};
// 确保 accessMode 不被覆盖
if (contextToSend.accessMode !== accessMode) {
  console.warn('[useChatStream] accessMode was overridden! Forcing to:', accessMode);
  contextToSend.accessMode = accessMode;
}
```

#### runInBackground 函数（第 263-295 行）
```typescript
const contextToSend = {
  ...copilotCtxRef.current,
  page: 'desktop-project',
  projectId,
  accessMode,
};
// 确保 accessMode 不被覆盖
if (contextToSend.accessMode !== accessMode) {
  console.warn('[runInBackground] accessMode was overridden! Forcing to:', accessMode);
  contextToSend.accessMode = accessMode;
}
```

### 2. 调试日志增强

添加了完整的日志链路：

1. **前端点击事件**（SimpleChat.tsx 1462、1473 行）
   ```typescript
   console.log('[SimpleChat] Switching to FULL/READ-ONLY access mode');
   ```

2. **前端发送**（useChatStream.ts 173 行）
   ```typescript
   console.log('[useChatStream] Sending context with accessMode:', accessMode);
   ```

3. **后端接收**（chat.js 521 行）
   ```typescript
   console.log('[chat.js] Received context:', JSON.stringify(context, null, 2));
   console.log('[chat.js] Computed accessMode:', accessModeValue);
   ```

4. **策略检查**（agent-tool-policy.js 128 行）
   ```typescript
   console.log('[agent-tool-policy] Checking tool call:', {
     toolName, isMutating, accessMode, ...
   });
   ```

5. **拦截触发**（agent-tool-policy.js 137 行）
   ```typescript
   console.log('[agent-tool-policy] READ-ONLY MODE TRIGGERED:', {...});
   ```

## 验证步骤

1. 重启 Electron：`npm run dev`
2. 打开开发者工具（Cmd+Option+I）
3. 切换到"完全访问"模式，发送：`请在项目根目录创建 test.txt 文件`
4. 观察日志：
   - `[SimpleChat] Switching to FULL access mode`
   - `[useChatStream] Sending context with accessMode: full`
   - `[chat.js] Computed accessMode: full`
   - 文件应该成功创建
5. 切换到"只读模式"，发送：`请删除 test.txt 文件`
6. 观察日志：
   - `[SimpleChat] Switching to READ-ONLY mode`
   - `[useChatStream] Sending context with accessMode: read`
   - `[agent-tool-policy] READ-ONLY MODE TRIGGERED`
   - 应该看到拒绝消息："聊天当前处于只读模式，禁止执行有副作用的工具"

## 后端验证逻辑（已存在，无需修改）

后端 `agent-tool-policy.js` 已有完整的检查逻辑：

- **第 136-148 行**：通用 mutating 操作检查
- **第 183-188 行**：workspace_exec 特殊检查
- **第 8 行**：MUTATING_SIDE_EFFECTS 包含所有破坏性操作

## 文件修改清单

1. ✅ `frontend/src/components/copilot/SimpleChat/hooks/useChatStream.ts`
   - 添加 accessMode 覆盖保护（send + runInBackground）
   - 添加调试日志

2. ✅ `frontend/src/components/copilot/SimpleChat.tsx`
   - 添加点击事件日志

3. ✅ `core/r-server/routes/ai-agent/chat.js`
   - 添加接收端日志

4. ✅ `core/r-server/agent-tools/agent-tool-policy.js`
   - 添加策略检查日志

## 预期结果

- ✅ 完全访问模式：允许所有工具调用
- ✅ 只读模式：拒绝所有破坏性工具（workspace_write, workspace_replace, workspace_exec 等）
- ✅ 清晰的错误提示："聊天当前处于只读模式，禁止执行有副作用的工具"
