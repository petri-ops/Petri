'use strict';

/**
 * telemetry-funnel.js — CK-10 漏斗事件白名单（纯函数，无 electron 依赖——
 * 逻辑/IO 分离，单测零 mock）。上报通道（reportEvent 的网络面）在 telemetry.js。
 */

const FUNNEL_EVENTS = [
  'app_started',
  'runtime_install',
  'project_created',
  'first_job_succeeded',
  'report_generated',
  'update_succeeded',
];

function isFunnelEvent(name) {
  return FUNNEL_EVENTS.includes(name);
}

module.exports = { FUNNEL_EVENTS, isFunnelEvent };
