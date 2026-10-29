/**
 * agent-tools/tool-defs/workflow.js — NEXT-01 工作流唯一 Agent 编排入口。
 */

module.exports = [
  {
    type: 'function',
    function: {
      name: 'run_workflow',
      description: '运行本地确定性多代理工作流（Q4b）。先 dryRun=true 获取步骤/agent/预算上界且零执行；用户确认后再 dryRun=false 启动。复用既有 workflow runner、journal、resume 与审批，不是第二执行器。后续建模 recipe 也统一用本工具。',
      parameters: {
        type: 'object',
        properties: {
          script: { type: 'string', description: '工作流 ESM 子集源码（export const meta + export default async function），≤256KB' },
          args: { type: 'object', additionalProperties: true, description: '传入脚本 run(ctx) 的参数；进入 argsHash' },
          dryRun: { type: 'boolean', description: 'true=只校验并返回步骤/agent/预算上界，零执行（默认 false）' },
          resumeFromRunId: { type: 'string', description: '可选；同 scriptHash+argsHash 的已完成前缀复用来源 runId' },
        },
        required: ['script'],
      },
    },
  },
];
