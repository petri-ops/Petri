'use strict';
const CHANNELS = require('./channels');

/**
 * IPC handlers: utility-host:* — QODER-L5 运行态（用户裁决放行）。
 *
 * 安全边界（全程决策层门控）：默认不装载；仅已安装且启用包 + 白名单入口可 fork；
 * 固定 argv、不传 MessagePort、不接管现有 pack iframe sandbox/CSP；超时/退出清理 + 审计。
 * sender 校验由全局 _ipc-trust 门自动生效（本模块不手写字面量通道）。
 */
const { ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { resolveCore } = require('../main/core-utils');
const {
  evaluateForkAdmission, reduceHostState, auditHostEvent,
} = require(resolveCore('shared-backend', 'utility-host-decision'));

const ACTIVE = new Map(); // packId -> { child, status, startedAt, entry }
const START_TIMEOUT_MS = 30_000;

function dataDir() {
  return process.env.PETRI_LOCAL_DATA_DIR
    || path.join(require('node:os').homedir(), 'Documents', 'Petri-Local');
}

function appendAudit(event) {
  try {
    const target = path.join(dataDir(), 'utility-host-audit.jsonl');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, `${auditHostEvent({ ...event, at: new Date().toISOString() })}\n`, 'utf8');
  } catch { /* 审计失败不影响主流程，但 fork 已发生——如实 best-effort */ }
}

function enabledPack(packId) {
  try {
    const registry = require(resolveCore('shared-backend', 'pack-registry'));
    const records = registry.readInstalledPacks(dataDir());
    const record = records.find((item) => item && item.packId === packId);
    return record && record.enabled !== false && record.packRoot ? record : null;
  } catch {
    return null;
  }
}

function readManifest(packRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(packRoot, 'pack.json'), 'utf8'));
  } catch {
    return null;
  }
}

function stopChild(packId) {
  const entry = ACTIVE.get(packId);
  if (!entry || !entry.child) return { ok: true, stopped: false };
  ACTIVE.set(packId, { ...entry, status: 'stopping' });
  try { entry.child.kill(); } catch { /* already gone */ }
  ACTIVE.delete(packId);
  appendAudit({ packId, action: 'stop', entry: entry.entry, status: 'stopped' });
  return { ok: true, stopped: true };
}

function registerUtilityHostIpc() {
  ipcMain.handle(CHANNELS.utilityHost.start, async (_event, packId) => {
    const id = String(packId || '');
    if (!id) return { ok: false, error: 'pack_id_required' };
    if (ACTIVE.has(id)) return { ok: false, error: 'already_running' };
    const pack = enabledPack(id);
    const manifest = pack ? readManifest(pack.packRoot) : null;
    const admission = evaluateForkAdmission({ pack, manifest });
    if (!admission.allowed) return { ok: false, error: admission.error };

    // 决策层放行后才 require Electron utilityProcess（主进程可用）。
    let utilityProcess;
    try { ({ utilityProcess } = require('electron')); } catch { return { ok: false, error: 'utility_unavailable' }; }
    if (!utilityProcess || typeof utilityProcess.fork !== 'function') return { ok: false, error: 'utility_unavailable' };

    const child = utilityProcess.fork(path.join(pack.packRoot, admission.entry), [], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PETRI_UTILITY_HOST_PACK: id },
    });
    ACTIVE.set(id, {
      child, status: reduceHostState({ status: 'stopped' }, 'start').status,
      startedAt: Date.now(), entry: admission.entry,
    });
    appendAudit({ packId: id, action: 'start', entry: admission.entry, status: 'starting' });
    child.once('spawn', () => {
      const current = ACTIVE.get(id);
      if (current) ACTIVE.set(id, { ...current, status: reduceHostState(current, 'spawned').status });
    });
    child.once('exit', () => {
      const current = ACTIVE.get(id);
      if (current) ACTIVE.set(id, { ...current, status: reduceHostState(current, 'exit').status });
      ACTIVE.delete(id);
      appendAudit({ packId: id, action: 'exit', entry: admission.entry, status: 'stopped' });
    });
    setTimeout(() => {
      const current = ACTIVE.get(id);
      if (current && current.status === 'starting') stopChild(id);
    }, START_TIMEOUT_MS).unref?.();
    return { ok: true, packId: id, status: 'starting', entry: admission.entry, messagePort: false };
  });

  ipcMain.handle(CHANNELS.utilityHost.stop, async (_event, packId) => stopChild(String(packId || '')));

  ipcMain.handle(CHANNELS.utilityHost.status, async () => ({
    ok: true,
    hosts: [...ACTIVE.entries()].map(([packId, entry]) => ({
      packId, status: entry.status, entry: entry.entry, startedAt: entry.startedAt,
    })),
  }));
}

function shutdownUtilityHosts() {
  for (const packId of [...ACTIVE.keys()]) stopChild(packId);
}

module.exports = { registerUtilityHostIpc, shutdownUtilityHosts }; // BLOCK-511 S2.5 — ACTIVE 内部 Map 无需导出（死导出清理）
