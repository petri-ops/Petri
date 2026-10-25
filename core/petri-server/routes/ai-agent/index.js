'use strict';

/**
 * routes/ai-agent/index.js — 子域注册中心（PHASE 2.2b）
 *
 * 汇总 5 个子域文件的 register(app) 函数，按原 routes/ai-agent.js 端点声明顺序调用：
 *   chat → context → events
 *
 * 共享闭包变量：
 *   - USE_AGENT_TASK_MODE（第 83 行）保留在本文件，注入给 chat.js
 *
 * 行为 100% 兼容：端点声明顺序、middleware、response shape 保持不变。
 */

const chat = require('./chat');
const context = require('./context');
const events = require('./events');
const trajectory = require('./trajectory'); // BLOCK-248（Q3）执行轨迹只读端点
const team = require('./team'); // BLOCK-249（Q4a）多智能体团队控制面
const tools = require('./tools');
const backgroundProcesses = require('./background-processes');
const llmTranscripts = require('./llm-transcripts');
const conversationChanges = require('./conversation-changes');
const resume = require('./resume');
const taskActions = require('./task-actions');
const decisions = require('./decisions'); // BLOCK-116 W2 决策观测面（只读聚合）
const workflow = require('./workflow'); // BLOCK-262（Q4b）工作流脚本（opt-in 默认关）
const costCap = require('./cost-cap'); // BLOCK-176 CP-18 任务级成本硬熔断

// AGENT_TASK_MODE_v1：默认 task 模式（loop 后台跑 + 订阅重连），legacy 回退到直连 SSE
const USE_AGENT_TASK_MODE = (process.env.PETRI_AGENT_TASK_MODE || 'task') !== 'legacy';

module.exports = {
  register(app) {
    if (typeof app.post !== 'function') {
      throw new Error('routes/ai-agent/index register requires an Express app');
    }
    // 端点声明顺序与原 routes/ai-agent.js 完全一致（chat → context → events）
    chat.register(app, { USE_AGENT_TASK_MODE });
    context.register(app);
    costCap.register(app); // BLOCK-176 CP-18
    events.register(app);
    trajectory.register(app); // BLOCK-248（Q3）
    team.register(app); // BLOCK-249（Q4a）
    backgroundProcesses.register(app);
    llmTranscripts.register(app);
    conversationChanges.register(app);
    resume.register(app);
    taskActions.register(app);
    decisions.register(app);
    workflow.register(app); // BLOCK-262（Q4b）
  },

  // 子模块 surface（方便测试与子域调试）
  _submodules: { chat, context, events, tools, backgroundProcesses, llmTranscripts, conversationChanges, resume },
};
