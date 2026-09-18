'use strict';

/**
 * src/ipc/startup-timeline.js — BLOCK-101 P0 启动 timeline 度量（D1 四段口径）
 *
 * 纯观测：主进程在既有时点打 marks（mainReady / windowShown / didFinishLoad），
 * 渲染层经 preload 暴露的 __startupPreloadMs（进程起点→preload 执行）+ paintTiming
 * （firstPaint）+ 左栏首屏数据到货（dataReady）自行采集，经 startup:report 汇总
 * 存档；flow/诊断经 startup:marks 拉取。无业务消费方，零行为影响。
 */

const CHANNELS = require('./channels');

// 进程起点（performance.timeOrigin 语义对齐：main 模块加载即打）
const PROCESS_START = Date.now();

const marks = {
  processStart: PROCESS_START,
  mainReady: null, // app.whenReady resolve
  preload: null, // webContents did-start-loading（preload 执行窗口）
  windowShown: null, // 首次 ready-to-show → show()
  didFinishLoad: null,
  reported: null, // 渲染层汇总（含 firstPaint/dataReadyMs）
};

function markStartup(name) {
  if (name && Object.prototype.hasOwnProperty.call(marks, name) && marks[name] == null) {
    marks[name] = Date.now();
  }
}

function setupStartupTimelineIpc({ ipcMain }) {
  ipcMain.on(CHANNELS.startup.report, (_event, payload) => {
    if (!payload || typeof payload !== 'object') return;
    marks.reported = { ...payload, receivedAt: Date.now() };
  });

  ipcMain.handle(CHANNELS.startup.marks, () => {
    const m = { ...marks };
    // 统一输出相对毫秒（自进程起点），调用方直接可比。
    // reported 是渲染层 payload 原样存档（其内含渲染进程相对值如 dataReadyMs/
    // firstPaintMs——页面时间轴，与主进程时间轴不同源，禁止二次换算）；
    // 只有 receivedAt（主进程收到时刻）参与相对化。
    const rel = {};
    for (const [k, v] of Object.entries(m)) {
      if (typeof v === 'number') rel[k] = v - PROCESS_START;
      else if (v && typeof v === 'object') {
        rel[k] = { ...v };
        if (typeof rel[k].receivedAt === 'number') {
          rel[k].receivedAt -= PROCESS_START;
        }
      }
    }
    return { ok: true, marks: rel };
  });
}

module.exports = { setupStartupTimelineIpc, markStartup, startupMarks: marks, PROCESS_START };
