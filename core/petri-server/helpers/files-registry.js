'use strict';

/**
 * helpers/files-registry.js — file_id 归属注册表（BLOCK-454 P4）。
 *
 * DeepSeek Files API 的 file_id 只该来自本机显式上传。本注册表记录每次上传的
 * 归属（docId / conversationId / purpose / sha256），供引用时做**归属校验**。
 *
 * BLOCK-196 教训（win32 路径切分让跨会话拒读整体空转）在此的直接落点：
 *  · 未知 / 外来 file_id → fail-closed（`file_id_unowned`），绝不静默放行；
 *  · 注册表文件损坏 / 不可读 → fail-closed（`files_registry_unreadable`），校验**不空转**
 *    ——「查不了」不是「放行」，是诚实拒绝（与 BLOCK-446 凭据三态同哲学）；
 *  · docId / conversationId 不匹配 → fail-closed（`file_id_doc_mismatch` / `file_id_session_mismatch`）。
 *
 * 存储形态：<PETRI_LOCAL_DATA_DIR>/files-registry.json（0600；tmp+rename 原子写）。
 * 刻意不进 sqlite：注册表是补充账本不是真相源（真相=Files API 服务端），坏档可整体
 * 重置而不伤业务库。
 */

const fs = require('fs');
const path = require('path');

function defaultStorePath() {
  const root = process.env.PETRI_LOCAL_DATA_DIR || path.join(require('os').homedir(), 'Documents', 'Petri-Local');
  return path.join(root, 'files-registry.json');
}

function emptyStore() {
  return { version: 1, files: {} };
}

function readStore(storePath) {
  const file = storePath || defaultStorePath();
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: true, store: emptyStore(), error: null };
    return { ok: false, store: null, error: 'unreadable' };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.files !== 'object' || parsed.files === null) {
      return { ok: false, store: null, error: 'corrupt' };
    }
    return { ok: true, store: parsed, error: null };
  } catch {
    return { ok: false, store: null, error: 'corrupt' };
  }
}

function writeStore(storePath, store) {
  const file = storePath || defaultStorePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  try { fs.chmodSync(tmp, 0o600); } catch { /* 平台差异不阻断 */ }
  fs.renameSync(tmp, file);
}

/**
 * 记录一次上传（fileId → 归属条目）。fileId 重复时覆盖为最新归属（重传语义）。
 */
function recordUploadedFile({ storePath, entry }) {
  const file = storePath || defaultStorePath();
  const read = readStore(file);
  const store = read.ok ? read.store : emptyStore();
  const e = entry || {};
  const fileId = String(e.fileId || '');
  if (!fileId) return { ok: false, code: 'file_id_required', message: 'fileId 必填。' };
  store.version = 1;
  // 无计算键赋值（security/detect-object-injection）：fromEntries 重建而非 store.files[fileId] 直写。
  store.files = Object.fromEntries([
    ...Object.entries(store.files),
    [fileId, {
      docId: e.docId || null,
      conversationId: e.conversationId || null,
      purpose: e.purpose || null,
      filename: e.filename || null,
      bytes: Number.isFinite(Number(e.bytes)) ? Number(e.bytes) : null,
      sha256: e.sha256 ? String(e.sha256).slice(0, 16) : null,
      createdAt: e.createdAt || new Date().toISOString(),
    }],
  ]);
  writeStore(file, store);
  return { ok: true, fileId };
}

/** 读取单条归属（供 UI/审计投影；不抛错）。 */
function getUploadedFile(fileId, storePath) {
  const read = readStore(storePath);
  if (!read.ok) return { ok: false, code: 'files_registry_unreadable', error: read.error };
  const entry = read.store.files[String(fileId || '')];
  return entry ? { ok: true, entry } : { ok: false, code: 'file_id_unowned' };
}

/**
 * 归属校验（引用 file_id 前调用）。fail-closed 三态：
 * 未知 id / 注册表不可读 / 归属不匹配。
 * @param {{storePath?:string, conversationId?:string, docId?:string}} opts - 两个归属维度至少给一个。
 */
function assertFileUsable(fileId, opts = {}) {
  const read = readStore(opts.storePath);
  if (!read.ok) {
    return {
      ok: false,
      code: 'files_registry_unreadable',
      message: `file_id 归属注册表不可读（${read.error}）：按 fail-closed 拒绝引用，不静默放行。请修复或重置 files-registry.json。`,
    };
  }
  const entry = read.store.files[String(fileId || '')];
  if (!entry) {
    return {
      ok: false,
      code: 'file_id_unowned',
      message: `file_id ${String(fileId).slice(0, 40)} 不在本机上传记录中：外来/未知 id 拒绝引用（fail-closed）。只能引用本机 Files API 上传并获得 file_id 的文件。`,
    };
  }
  if (opts.docId && entry.docId && String(opts.docId) !== String(entry.docId)) {
    return {
      ok: false,
      code: 'file_id_doc_mismatch',
      message: `file_id 属于文档 ${entry.docId}，请求按 ${opts.docId} 引用：归属不匹配，拒绝。`,
    };
  }
  if (opts.conversationId && entry.conversationId && String(opts.conversationId) !== String(entry.conversationId)) {
    return {
      ok: false,
      code: 'file_id_session_mismatch',
      message: `file_id 登记于会话 ${entry.conversationId}，当前会话 ${opts.conversationId}：归属不匹配，拒绝。`,
    };
  }
  return { ok: true, entry };
}

module.exports = {
  defaultStorePath,
  recordUploadedFile,
  getUploadedFile,
  assertFileUsable,
};
