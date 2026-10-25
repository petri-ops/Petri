'use strict';

/**
 * crash-guard.js — BLOCK-228 本地崩溃记录（不上传、不解析栈）。
 *
 * - crashReporter 仅本地 dump（uploadToServer:false）；
 * - session-health.json 记录本次启动，正常退出时置 cleanExit:true；
 * - 启动时若上次未 cleanExit → status.uncleanExit=true，并列出 dump 文件名/大小/时间；
 * - 只做文件级证据，minidump 解析属 reopen。
 */

const fs = require('node:fs');
const path = require('node:path');
const { summarizeDumpFile } = require('./minidump-summary');

function evaluateSessionHealth(previous, dumps) {
  const list = Array.isArray(dumps) ? dumps : [];
  return {
    uncleanExit: Boolean(previous && previous.cleanExit !== true),
    previousStartedAt: typeof previous?.startedAt === 'string' ? previous.startedAt : null,
    lastCleanExitAt: typeof previous?.cleanExitAt === 'string' ? previous.cleanExitAt : null,
    dumps: list.slice(0, 5),
  };
}

function createCrashGuard({ app, crashReporter, isTestInstance = false }) {
  let sessionStartedAt = null;
  let status = {
    uncleanExit: false,
    previousStartedAt: null,
    lastCleanExitAt: null,
    dumps: [],
    crashDumpsDir: null,
    simulated: false,
  };

  const healthFile = () => path.join(app.getPath('userData'), 'session-health.json');

  function readPrevious() {
    try {
      return JSON.parse(fs.readFileSync(healthFile(), 'utf8'));
    } catch {
      return null;
    }
  }

  function writeHealth(payload) {
    try {
      fs.mkdirSync(path.dirname(healthFile()), { recursive: true });
      fs.writeFileSync(healthFile(), JSON.stringify(payload));
    } catch {
      // 健康记录失败不阻塞启动。
    }
  }

  function listDumps() {
    try {
      const dir = app.getPath('crashDumps');
      return fs.readdirSync(dir)
        .filter((name) => /\.dmp$/i.test(name))
        .map((name) => {
          try {
            const stat = fs.statSync(path.join(dir, name));
            return { name, size: stat.size, mtime: stat.mtime.toISOString() };
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => b.mtime.localeCompare(a.mtime))
        .slice(0, 5);
    } catch {
      return [];
    }
  }

  function start() {
    try {
      crashReporter.start({
        uploadToServer: false,
        compress: false,
        productName: 'Petri',
        companyName: 'Petri',
      });
    } catch {}
    status = {
      ...evaluateSessionHealth(readPrevious(), listDumps()),
      crashDumpsDir: app.getPath('crashDumps'),
      simulated: false,
    };
    sessionStartedAt = new Date().toISOString();
    writeHealth({ startedAt: sessionStartedAt, cleanExit: false });
  }

  function markCleanExit() {
    writeHealth({ startedAt: sessionStartedAt, cleanExit: true, cleanExitAt: new Date().toISOString() });
  }

  function getStatus() {
    return { ok: true, ...status };
  }

  async function openDumps() {
    try {
      const { shell } = require('electron');
      const dir = status.crashDumpsDir || app.getPath('crashDumps');
      const error = await shell.openPath(dir);
      return error ? { ok: false, error } : { ok: true };
    } catch (error) {
      return { ok: false, error: (error && error.message) || 'open_failed' };
    }
  }

  /** BLOCK-260 K2 — 本地只读摘要（不解析栈、不上传）；名称限定为目录内 .dmp 文件。 */
  function summarizeDump(name) {
    const requested = String(name || (status.dumps && status.dumps[0] && status.dumps[0].name) || '');
    const safeName = path.basename(requested);
    if (!safeName || safeName !== requested || !/\.dmp$/i.test(safeName)) {
      return { ok: false, error: 'invalid_dump_name' };
    }
    const dir = status.crashDumpsDir || app.getPath('crashDumps');
    return { ...summarizeDumpFile(path.join(dir, safeName)), name: safeName };
  }

  function simulateForTest(payload) {
    if (!isTestInstance) return { ok: false, reason: 'test_instance_only' };
    const source = payload && typeof payload === 'object' ? payload : {};
    status = {
      ...status,
      uncleanExit: source.uncleanExit === true,
      previousStartedAt: typeof source.previousStartedAt === 'string' ? source.previousStartedAt : status.previousStartedAt,
      dumps: Array.isArray(source.dumps) ? source.dumps.slice(0, 5) : status.dumps,
      simulated: true,
    };
    return { ok: true, status: getStatus() };
  }

  return { start, markCleanExit, getStatus, openDumps, summarizeDump, simulateForTest };
}

module.exports = { createCrashGuard, evaluateSessionHealth };
