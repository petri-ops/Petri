'use strict';

/**
 * shared-telemetry/funnel-events.js — 漏斗事件白名单唯一真相（前后端共享层）。
 *
 * 归属（BLOCK-186 架构裁决）：漏斗事件清单被两进程共用——Electron 主进程（src）本地台账写
 * app_started/runtime_install，后端进程（core/petri-server）本地台账写 project_created/
 * first_job_succeeded/report_generated。因 dependency-cruiser R3（core 禁 import src）与
 * R5（src 禁 import core/petri-server），跨进程共享的唯一合法落点是 core/packages（共享层，
 * R4 注释确认）。故清单置此，src/telemetry-funnel.js 与 core/petri-server/helpers/funnel-log.js
 * 各自从此单源引入，杜绝第二份清单。纯数据，无 electron / 无 DB 依赖。
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
