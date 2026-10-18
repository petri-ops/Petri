'use strict';

/**
 * helpers/data-dir-migration.js — 数据目录迁移**计划器**（BLOCK-210 / W7e）。
 *
 * 只读：本模块不 mkdir、不 rename、不复制——它只回答"如果要从 from 搬到 to，
 * 步骤是什么、备份落在哪、怎么回退、有哪些阻塞项"。
 *
 * 为什么不执行：`petri.db` / `-wal` / `-shm`、results、uploads 都可能在写；
 * 没有一次性停写窗口和备份演练就搬迁 = 直接拿用户数据冒险（plan §0）。
 */

const fs = require('node:fs');
const path = require('node:path');

/** 判断目录是否"看起来有数据"。 */
function dirEntries(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return null;
  }
}

/**
 * @param {{from:string, to:string, now?:Date}} input
 * @returns {{ok:boolean, steps:string[], backupPath:string|null, rollback:string[], blockers:string[], from:string, to:string}}
 */
function planMigration({ from, to, now = new Date() } = {}) {
  const src = typeof from === 'string' ? from.trim() : '';
  const dst = typeof to === 'string' ? to.trim() : '';
  const blockers = [];
  const steps = [];
  const rollback = [];

  if (!src || !dst) {
    return { ok: false, steps, backupPath: null, rollback, blockers: ['from/to 都必须是非空绝对路径'], from: src, to: dst };
  }
  if (!path.isAbsolute(src) || !path.isAbsolute(dst)) blockers.push('from/to 必须是绝对路径（相对路径会随 cwd 漂移）');
  if (path.resolve(src) === path.resolve(dst)) blockers.push('from 与 to 指向同一目录');

  const srcEntries = dirEntries(src);
  if (srcEntries === null) blockers.push(`源目录不可读或不存在：${src}`);
  const dstEntries = dirEntries(dst);
  if (dstEntries && dstEntries.length > 0) blockers.push(`目标目录已存在且非空：${dst}（迁移会覆盖用户数据）`);
  if (srcEntries) {
    const hasWal = srcEntries.some((name) => name === 'petri.db-wal' || name === 'petri.db-shm');
    if (hasWal) blockers.push('检测到 petri.db-wal/-shm：数据库疑似仍在运行，必须先停写再迁移');
  }
  if (path.parse(src).root !== path.parse(dst).root) {
    blockers.push('跨卷迁移：cp 不是原子的，需分阶段复制 + 校验 + 切换（见 steps）');
  }

  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const backupPath = `${src}.bak-${stamp}`;

  steps.push(`1. 停写：停止后端/桌面进程，确认无 petri.db-wal / -shm 残留`);
  steps.push(`2. 备份：cp -a "${src}" "${backupPath}"（保留原目录不动，这是回退点）`);
  steps.push(`3. 复制：cp -a "${src}/." "${dst}/"（先复制再校验，不在源目录做任何删除）`);
  steps.push('4. 校验：对比文件数/总字节/petri.db 的 integrity_check（sqlite3 PRAGMA integrity_check）');
  steps.push(`5. 切换：把数据目录指向 "${dst}"（env PETRI_LOCAL_DATA_DIR），重启后跑一次 smoke`);
  steps.push('6. 保留备份至少 7 天；确认无回滚需求后再由用户手动删除');
  rollback.push(`回退=把 PETRI_LOCAL_DATA_DIR 指回 "${src}"（源目录全程未被修改）`);
  rollback.push(`若已删除源目录：cp -a "${backupPath}" "${src}" 后重启`);

  return { ok: blockers.length === 0, steps, backupPath, rollback, blockers, from: src, to: dst };
}

module.exports = { planMigration };
