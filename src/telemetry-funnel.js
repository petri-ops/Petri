'use strict';

/**
 * telemetry-funnel.js — CK-10 漏斗事件白名单（re-export）。
 *
 * BLOCK-186：清单唯一真相迁入跨进程共享层 core/packages/shared-telemetry/funnel-events.js
 * （Electron 主进程与后端进程共用同一 funnel_events 台账，需同一份白名单；R3/R5 禁两侧互
 * import，共享层是唯一合法落点）。本文件保留原 require('./telemetry-funnel') 入口不变，
 * 仅转发，杜绝第二份清单。
 */

module.exports = require('../core/packages/shared-telemetry/funnel-events.js');
