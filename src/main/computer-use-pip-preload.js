'use strict';

/**
 * src/main/computer-use-pip-preload.js — BLOCK-264（C-38）PiP 预加载。
 *
 * 自包含字面量（sandbox 进程不 require 本地模块——项目 IPC 纪律）：
 * 只暴露拉帧/关闭两个异步包装。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pipApi', {
  pullFrame: () => ipcRenderer.invoke('computer-use:pip-frame'),
  close: () => ipcRenderer.invoke('computer-use:pip-close'),
});
