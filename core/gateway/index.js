/**
 * core/gateway/index.js — Gateway 模块导出
 */

const server = require('./server');
const agent = require('./agent');
const pipeline = require('./pipeline');

module.exports = {
  server,
  agent,
  pipeline,
  // 直接导出常用函数
  getHealth: agent.getHealth,
  listTools: agent.listTools,
  getTool: agent.getTool,
  executeTool: agent.executeTool,
  executePipeline: pipeline.executePipeline,
  getPipelineStatus: pipeline.getPipelineStatus,
  callRServer: agent.callRServer,
  callPyServer: agent.callPyServer,
  getAllServiceStatus: agent.getAllServiceStatus,
  GatewayError: agent.GatewayError,
  PipelineError: pipeline.PipelineError,
  PipelineStepError: pipeline.PipelineStepError,
};
