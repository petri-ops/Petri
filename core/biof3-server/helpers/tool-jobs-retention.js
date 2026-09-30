'use strict';

/**
 * tool-jobs-retention.js — BLOCK-136（G0-PLATFORM PL-4 机制先行·tool_jobs 保留清扫）。
 *
 * 纯函数：给定 db 与保留天数，删除 tool_jobs 中超窗的**终态**行，并对全局
 * 目录做 best-effort 级联清理。默认关闭（retentionDays<=0 直接返回 disabled
 * 且不查库）——保留策略数值属 PL-D2 用户裁决，机制先行、默认值留裁决；与
 * BLOCK-135 重试默认关闭（BIOF3_TOOL_RETRY_MAX 默认 0）同一姿势。生产接线
 * 在 jobs/retention-sweeper.js（BIOF3_TOOL_JOBS_RETENTION_DAYS，默认 0=关闭）。
 *
 * 保护边界（绝不逾越）：
 * - 绝不碰非终态行：status NOT IN ('completed','failed','cancelled')——
 *   pending/running（含失活对账器管辖域）永不删；
 * - 绝不碰 protectedJobIds：调用方传入的公开演示作业清单（生产接线同源取
 *   helpers/tools-assets 的 PUBLIC_DEMO_JOB_IDS）；
 * - 目录只清全局布局 <jobsDir>/<jobId>：项目布局目录
 *   （<project>/results/jobs/<jobId>）绝不动——归项目 GC 域；
 * - 目录清理 best-effort：失败仅 console.warn，不中断行删除（行已删则目录
 *   成为孤儿，风险登记与 PL-4a 内联段一致：下次 sweep 不再命中该行）。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// 分批上限：单轮 SELECT/DELETE 最多 200 行，避免长事务长时间持写锁
// （与 PL-4b 批量删除端点的 200 上限同一量纲）。
const SWEEP_BATCH_SIZE = 200;

/**
 * @param {object} [input]
 * @param {import('better-sqlite3').Database} [input.db]  biof3-server 主库
 * @param {number} [input.now]  当前时刻（毫秒；默认 Date.now()，测试注入用）
 * @param {number} [input.retentionDays]  保留天数；<=0 / 非数值视为关闭
 * @param {string|null} [input.jobsDir]  全局 tool-jobs 目录；null=只删行不清目录
 * @param {string[]} [input.protectedJobIds]  保护清单（公开演示作业等）
 * @returns {{ deleted: number, ids: string[], reason: string }}
 *   reason: 'disabled'（retentionDays<=0，不查库）/ 'db_not_provided' / 'ok'
 */
function retentionSweep({ db, now = Date.now(), retentionDays, jobsDir = null, protectedJobIds = [] } = {}) {
  const days = Number(retentionDays);
  if (!Number.isFinite(days) || days <= 0) {
    return { deleted: 0, ids: [], reason: 'disabled' };
  }
  if (!db) {
    return { deleted: 0, ids: [], reason: 'db_not_provided' };
  }

  const protectedSet = new Set(protectedJobIds || []);
  const cutoffMs = now - days * DAY_MS;
  const deletedIds = [];
  const deleteStmt = db.prepare('DELETE FROM tool_jobs WHERE id = ?');

  // 分批循环：先 SELECT 收集一批候选 ids，再逐条 DELETE，直至无删减。
  // 保护清单在 SQL 里排除（NOT IN）——若只在 JS 侧过滤，「一批全被保护」
  // 会使下一批选中同样的行而空转死循环。
  const protectedKeys = [...protectedSet];
  const notInSql = protectedKeys.length
    ? ` AND id NOT IN (${protectedKeys.map(() => '?').join(',')})`
    : '';
  const selectStmt = db.prepare(`
    SELECT id FROM tool_jobs
    WHERE status IN ('completed','failed','cancelled')
      AND COALESCE(is_public, 0) = 0
      AND created_at < ?${notInSql}
    LIMIT ${SWEEP_BATCH_SIZE}
  `);

  for (;;) {
    const batch = selectStmt.all(cutoffMs, ...protectedKeys);
    if (batch.length === 0) break;
    for (const row of batch) {
      deleteStmt.run(row.id);
      deletedIds.push(row.id);
    }
    if (batch.length < SWEEP_BATCH_SIZE) break; // 候选耗尽
  }

  if (jobsDir && deletedIds.length > 0) {
    // 懒 require：目录清理仅在有实删时才需要（core 惰性加载惯例）
    const fs = require('node:fs');
    const path = require('node:path');
    for (const id of deletedIds) {
      try {
        // 只清全局布局 <jobsDir>/<id>；项目布局目录绝不动（归项目 GC 域）。
        // force:true 对不存在的目录静默跳过，无需先 existsSync。
        fs.rmSync(path.join(jobsDir, id), { recursive: true, force: true });
      } catch (e) {
        console.warn(`tool-jobs-retention: dir cleanup failed id=${id} reason=${e && e.message}`);
      }
    }
  }

  return { deleted: deletedIds.length, ids: deletedIds, reason: 'ok' };
}

module.exports = {
  retentionSweep,
  SWEEP_BATCH_SIZE,
};
