/**
 * agent-tools/tool-defs/goals.js — Q7（BLOCK-256）目标工具 Schema。
 * 执行元数据见 ../tool-metadata.js 与 registry CONTRACTS。
 */

module.exports = [
  {
    type: 'function',
    function: {
      name: 'create_goal',
      description: '创建一个持久目标（跨轮/跨会话可查）。目标有 active/paused/completed/blocked 状态和可选 token 预算；预算用量从本地 ai_usage 真实账本投影。项目内目标必须带 projectId（工作台上下文会自动注入）。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '目标标题（≤120 字）' },
          description: { type: 'string', description: '目标说明/完成判据（可选，≤2000 字）' },
          budgetTokens: { type: 'integer', description: '可选 token 预算；0/省略=不设预算' },
          projectId: { type: 'string', description: '项目 ID；省略时用当前工具上下文' },
          conversationId: { type: 'string', description: '可选归属会话；省略时用当前会话' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_goal',
      description: '查询目标：传 goalId 取单个，不传则列当前项目的全部目标。返回状态、用量 token、预算、usageLimited/budgetLimited、已用时长与剩余预算。只读。',
      parameters: {
        type: 'object',
        properties: {
          goalId: { type: 'string', description: '可选；目标 ID' },
          projectId: { type: 'string', description: '列表时用；省略时用当前工具上下文' },
          limit: { type: 'integer', description: '列表上限（默认 50，最大 100）' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_goal',
      description: '更新目标状态/标题/说明/预算。状态机：active→paused/completed/blocked；paused/blocked→active/completed；completed→active（重开）。非法迁移会被拒绝。',
      parameters: {
        type: 'object',
        properties: {
          goalId: { type: 'string', description: '目标 ID' },
          status: { type: 'string', enum: ['active', 'paused', 'completed', 'blocked'], description: '目标新状态' },
          title: { type: 'string', description: '可选新标题' },
          description: { type: 'string', description: '可选新说明' },
          budgetTokens: { type: 'integer', description: '可选新 token 预算；0=取消预算' },
        },
        required: ['goalId'],
      },
    },
  },
];
