'use strict';

/**
 * src/main/startup-timeline-bridge.js — BLOCK-101 P0 打点桥。
 *
 * 单一事实源在 src/ipc/startup-timeline.js（同一次 require 得到同一模块实例）；
 * 本桥仅为 _window-create.js 提供懒加载入口，加载失败静默（度量不阻塞启动）。
 */

const { markStartup } = require("../ipc/startup-timeline");
module.exports = { markStartup };
