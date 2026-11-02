'use strict';

/**
 * governance/audit-open-items.js — BLOCK-337 P2：只读解析受治理仓审计台的未决广播行。
 *
 * 只认两种行首：`| 🔴 |`（先处理）与 `| 🟢 |`（评估）；🟡（登记待办）不算开工前置。
 * 引擎不解释内容，只投影「前 N 条摘要」给 prompt 动态段；解析失败一律返回空数组
 * （审计台损坏不得阻断工作区打开）。
 */

const fs = require('node:fs');

const SEVERITY_ORDER = { '🔴': 0, '🟢': 1 };

function clip(text, max = 120) {
  const value = String(text || '').replace(/\s+/g, ' ').replace(/\*\*/g, '').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * @param {string} auditLogPath 审计台文件绝对路径
 * @param {{limit?: number}} options
 * @returns {Array<{severity:string, summary:string}>}
 */
function parseOpenAuditItems(auditLogPath, { limit = 5 } = {}) {
  if (typeof auditLogPath !== 'string' || !auditLogPath) return [];
  let rows;
  try {
    rows = fs.readFileSync(auditLogPath, 'utf8').split(/\r?\n/);
  } catch {
    return [];
  }
  const items = [];
  for (const line of rows) {
    const match = /^\|\s*(🔴|🟢)\s*\|/.exec(line);
    if (!match) continue;
    const cells = line.split('|').map((cell) => cell.trim());
    // cells[0]='' , [1]=severity, [2]=date, [3]=摘要
    const summary = clip(cells[3] || cells[2] || '');
    if (!summary) continue;
    items.push({ severity: match[1], summary });
    if (items.length >= Math.max(1, limit) * 4) break; // 粗截断，避免超长台账全量扫描
  }
  items.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
  return items.slice(0, Math.max(1, limit));
}

module.exports = { parseOpenAuditItems, clip };
