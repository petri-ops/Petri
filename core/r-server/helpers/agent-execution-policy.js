'use strict';

function inferExecutionPolicy(messages) {
  const latestUser = Array.isArray(messages)
    ? [...messages].reverse().find((message) => message && message.role === 'user')
    : null;
  const text = String((latestUser && latestUser.content) || '').trim();
  const confirmedRun =
    /ackToken\s*=\s*ack_[a-z0-9-]+/i.test(text) && /(?:已确认|续跑|继续执行)/.test(text);
  const readOnlyRequest = [
    /先不要执行/,
    /不要执行任何(?:分析|工具|任务|操作)?/,
    /(?:只|仅)(?:需要|需|做|进行)?(?:检查|查看|识别|评估|规划|生成计划|告诉我)/,
    /(?:只|仅).*?(?:检查|查看|识别|评估|规划).*?(?:不要|无需|不需要).*?执行/,
  ].some((pattern) => pattern.test(text));
  return {
    allowExecution: confirmedRun || !readOnlyRequest,
    reason: readOnlyRequest && !confirmedRun ? 'explicit_read_only_request' : null,
  };
}

module.exports = { inferExecutionPolicy };
