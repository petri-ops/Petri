// ============================================================
// dev-launch-state — BLOCK-45 dev-electron 启动记录与 boot 清理决策
//
// 纯逻辑段（无 Electron/进程操作），供 scripts/dev-electron.js 消费并可被
// node --test 直接单测。
//
// 背景：dev-electron 的 boot 清理曾用 pgrep 按二进制路径全杀工作区 Electron
// 主进程，误杀并存 dev 栈实例（BLOCK-43 P3 实测踩中）。BLOCK-35 已把 wrapper
// 退出路径改为一次性启动 token 定向；本模块把同一哲学扩展到 boot 清理：
//   1. 每个 wrapper 启动时把 { token, wrapperPid, startedAt } 持久化到
//      userData 目录（dev-launch-token.json）；
//   2. 下次 boot 读上一记录：wrapper 仍存活且其 token 命中 Electron →
//      fail-closed（先停旧栈）；wrapper 已死 → token 定向清理残留；
//      无记录 → 跳过（pre-BLOCK-45 残留走 --force-clean-electron 逃生口）。
// ============================================================

const fs = require('fs');
const path = require('path');

/** 记录文件名（位于 electronUserDataDir 下，gitignore 目录）。 */
const LAUNCH_RECORD_FILENAME = 'dev-launch-token.json';

function launchRecordPath(userDataDir) {
  return path.join(userDataDir, LAUNCH_RECORD_FILENAME);
}

/**
 * 读取上一 wrapper 的启动记录。文件缺失 / JSON 损坏 / 字段缺失 → null
 * （fail-open 到「无记录」，boot 清理跳过 Electron 段）。
 */
function readLaunchRecord(userDataDir) {
  try {
    const raw = fs.readFileSync(launchRecordPath(userDataDir), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.token !== 'string' || !parsed.token) return null;
    if (!Number.isInteger(parsed.wrapperPid) || parsed.wrapperPid <= 0) return null;
    return { token: parsed.token, wrapperPid: parsed.wrapperPid, startedAt: parsed.startedAt || null };
  } catch {
    return null;
  }
}

/** 写入本次启动记录（boot 时调用，先于 Electron 启动）。 */
function writeLaunchRecord(userDataDir, record) {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(
    launchRecordPath(userDataDir),
    JSON.stringify({ ...record, savedAt: new Date().toISOString() }, null, 2) + '\n',
  );
}

/** 清除启动记录（wrapper 优雅退出时 best-effort 调用）。文件不存在不报错。 */
function clearLaunchRecord(userDataDir) {
  try {
    fs.unlinkSync(launchRecordPath(userDataDir));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

/**
 * boot 阶段 Electron 清理决策（纯函数）。
 *
 * @param {object} input
 * @param {{ token: string, wrapperPid: number } | null} input.record 上一启动记录
 * @param {boolean} input.wrapperAlive 上一 wrapper 进程是否仍存活
 * @param {boolean} input.hasTokenPids 上一 token 定向 pgrep 是否命中 Electron 主进程
 * @param {boolean} input.forceClean 显式 `--force-clean-electron` 逃生口
 * @returns {{ action: 'skip'|'fail'|'cleanup'|'force', token?: string, message?: string }}
 */
function resolveBootElectronAction({ record, wrapperAlive, hasTokenPids, forceClean }) {
  if (forceClean) return { action: 'force' };
  if (!record) return { action: 'skip' };
  if (wrapperAlive && hasTokenPids) {
    return {
      action: 'fail',
      message:
        `Petri dev stack is already running (wrapper pid ${record.wrapperPid}, launched ${record.startedAt || 'unknown'}). ` +
        `Stop it first (Ctrl+C in its terminal, or: kill ${record.wrapperPid}), ` +
        `then re-run npm run dev. To override this check and force-clean all workspace Electron processes, pass --force-clean-electron.`,
    };
  }
  if (!wrapperAlive && hasTokenPids) {
    return { action: 'cleanup', token: record.token };
  }
  return { action: 'skip' };
}

module.exports = {
  LAUNCH_RECORD_FILENAME,
  launchRecordPath,
  readLaunchRecord,
  writeLaunchRecord,
  clearLaunchRecord,
  resolveBootElectronAction,
};
