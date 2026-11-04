/**
 * agent-tools/tool-defs/harness.js — harness 域工具 Schema（BLOCK-346 方向2）。
 *
 * 现状补口：`POST /api/harness/scientific-task/plan` 早已实现「证据优先的科研任务
 * 计划生成」（索引本机 harness 资产 → 匹配插件/证据 → 产出可执行计划），但前端与
 * agent 侧都没有消费方 —— 能力只在 curl 里活着。
 *
 * 这里只接 **plan（只读分析）**：它不创建 tool_job、不写库，因此契约 R0。
 * `confirmation-preview` / `confirm`（落库确认）涉及"把计划变成真任务"，需要
 * 前端确认卡与之配套，留作后续（reopen），不在本工具里硬塞。
 */

module.exports = [
  {
    type: 'function',
    function: {
      name: 'harness_plan_task',
      description: '把科研任务草案交给「证据优先」计划引擎：索引本机 harness 资产（数据/脚本/环境/既有结果），产出可执行步骤、所需插件与缺口清单。**只读分析，不创建任何任务**。taskSpec.projectId 必填。',
      parameters: {
        type: 'object',
        properties: {
          taskSpec: {
            type: 'object',
            additionalProperties: true,
            description: '科研任务草案（对象）。至少含 projectId；其余字段按 harness 任务规范填写（分析目标、输入数据、预期产出）。',
          },
          runtime: {
            type: 'object',
            additionalProperties: true,
            description: '可选：运行环境约束（如 R 版本、必需包），会参与可行性判定。',
          },
        },
        required: ['taskSpec'],
      },
    },
  },
];
