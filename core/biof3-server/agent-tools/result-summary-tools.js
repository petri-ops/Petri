'use strict';

/**
 * agent-tools/result-summary-tools.js — BLOCK-121 P2（B1）结果内容只读读取工具。
 *
 * 断点（plan docs/block-121-result-loop-vertical-plan.md §8.2.4）：run_tool 的结果
 * 摘要只在同轮 tool_result 可见（且截 6000 字符），跨轮没有任何工具能按 toolJobId
 * 读回结果内容——模型对「这个结果说明了什么」只能凭记忆或猜测作答。
 *
 * result_summary — 有界读取：job 元信息 + artifactTruth + manifest.summary 关键统计
 * + 产物清单（≤20）+ 主表前几行真值（列 ≤8 / 行 ≤6 / 单元格截 24 字）。
 *
 * 诚实边界：
 *  - 只读（contract sideEffect=none / metadata readOnly）；不写任何状态。
 *  - 有界输出与 result_studio_context 同纪律：不整表倾倒，不给无界路径枚举。
 *  - job 不存在/未完成=available:false 如实回传，不伪造内容。
 */

const fs = require('node:fs');
const path = require('node:path');

const MAX_ARTIFACTS = 20;
const MAX_COLS = 8;
// BIO-6b（2026-09-29）— 真值窗口有界扩容 6→20：分析场景 padj 排序后前 20 行通常覆盖
// 主要 hit。6k 字符模型投影预算内安全（预算钉见 result-summary-tool.test.mjs：
// worst-case 20 行×8 列×24 字符序列化 <6000 实测锁定）；更宽窗口走专属投影通道，
// 与 BIO-D4（interpret/result_summary 收敛）一并裁决。
const MAX_ROWS = 20;
const MAX_CELL_CHARS = 24;
const MAX_TABLE_BYTES = 8 * 1024 * 1024;

function clipCell(value) {
  const s = String(value);
  return s.length > MAX_CELL_CHARS ? s.slice(0, MAX_CELL_CHARS) + '…' : s;
}

/** 最小带引号感知 CSV 行切分（插件产物为标准 RFC4180 子集）。 */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (line.charAt(i + 1) === '"') { cur += '"'; i += 1; } else { inQuotes = false; }
      } else { cur += ch; }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur); cur = '';
    } else { cur += ch; }
  }
  out.push(cur);
  return out;
}

/** 从 manifest/artifacts 里挑主表 artifact：名字含 table 的优先，取第一个。 */
function pickPrimaryArtifact(job) {
  const artifacts = Array.isArray(job && job.artifacts) ? job.artifacts : [];
  return artifacts.find((a) => a && a.type === 'table')
    || artifacts.find((a) => /table|_table\.csv$/i.test(a.filename || a.name || ''))
    || null;
}

/** 读主表头部真值（列 ≤MAX_COLS、行 ≤MAX_ROWS、单元格截断）。纯函数便于契约测试。 */
function readTablePreview(artifact) {
  const filePath = artifact && (artifact.path || artifact.canonicalPath);
  if (!filePath || !fs.existsSync(filePath)) return { available: false, reason: 'artifact_file_missing' };
  let stat;
  try { stat = fs.statSync(filePath); } catch { return { available: false, reason: 'artifact_stat_failed' }; }
  if (!stat.isFile() || stat.size > MAX_TABLE_BYTES) return { available: false, reason: 'artifact_too_large' };
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { available: false, reason: 'artifact_empty' };
  const header = splitCsvLine(lines[0]).slice(0, MAX_COLS).map(clipCell);
  const rows = lines.slice(1, 1 + MAX_ROWS).map((l) => splitCsvLine(l).slice(0, MAX_COLS).map(clipCell));
  return {
    available: true,
    file: path.basename(filePath),
    columns: header,
    rows,
    totalDataRows: lines.length - 1,
    truncated: {
      columns: lines[0].split(',').length > MAX_COLS,
      rows: lines.length - 1 > MAX_ROWS,
    },
  };
}

/** 纯汇总装配（契约测试直测；jobRow=tool_jobs 行，resultJson 已解析）。 */
function buildResultSummary(jobRow, resultJson) {
  const job = {
    id: jobRow.id,
    toolId: jobRow.tool_id || jobRow.toolId,
    status: jobRow.status,
    name: jobRow.name || null,
    conversationId: jobRow.conversation_id || jobRow.conversationId || null,
    completedAt: jobRow.completed_at || jobRow.completedAt || null,
    error: jobRow.error || null,
  };
  const truth = resultJson && resultJson.artifactTruth
    ? { status: resultJson.artifactTruth.status, blocking: !!resultJson.artifactTruth.blocking }
    : null;
  const summary = (resultJson && resultJson.manifest && resultJson.manifest.summary) || null;
  const allArtifacts = Array.isArray(resultJson && resultJson.artifacts) ? resultJson.artifacts : [];
  const artifacts = allArtifacts.slice(0, MAX_ARTIFACTS).map((a) => ({
    name: a.filename || a.name,
    type: a.type || null,
  }));
  const primary = pickPrimaryArtifact(resultJson);
  const table = readTablePreview(primary);
  return {
    job,
    truth,
    summary,
    artifactCount: allArtifacts.length,
    artifacts,
    artifactsTruncated: allArtifacts.length > MAX_ARTIFACTS,
    table,
  };
}

/**
 * result_summary — 按 toolJobId 有界读取结果内容。
 * @param {{toolJobId: string}} args
 * @param {{getToolJob?: (id: string) => object|undefined}} [deps] 测试注入点
 */
async function tool_result_summary(args, deps = {}) {
  const jobId = typeof (args && args.toolJobId) === 'string' ? args.toolJobId.trim() : '';
  if (!jobId) {
    return { ok: false, error: 'missing_toolJobId', message: '需要 toolJobId（run_tool 返回的 toolJobId，或当前打开结果的 jobId）。' };
  }
  const getToolJob = deps.getToolJob || ((id) => {
    try { return require('../db').getToolJob(id); } catch { return undefined; }
  });
  let row;
  try { row = getToolJob(jobId); } catch { row = undefined; }
  if (!row) {
    return { ok: true, available: false, message: `找不到任务 ${jobId}（不存在或无权访问）。` };
  }
  let resultJson = null;
  try { resultJson = row.result_json ? JSON.parse(row.result_json) : null; } catch { resultJson = null; }
  if (!resultJson) {
    return { ok: true, available: false, job: { id: row.id, toolId: row.tool_id, status: row.status }, message: '该任务还没有可读的结果内容。' };
  }
  const data = buildResultSummary(row, resultJson);
  const s = data.summary || {};
  const statText = Number.isFinite(s.sig_genes)
    ? `关键统计：总基因 ${s.total_genes}，显著 ${s.sig_genes}（上调 ${s.up} / 下调 ${s.down}）。`
    : '';
  return {
    ok: true,
    available: true,
    ...data,
    message: `任务 ${data.job.id}（${data.job.toolId}，${data.job.status}）结果摘要。${statText} 产物 ${data.artifactCount} 项；主表 ${data.table.available ? `${data.table.file} 前 ${data.table.rows.length} 行真值（共 ${data.table.totalDataRows} 行）` : '不可读'}。数字以上方 summary/table 为准，引用时不要编造。`,
  };
}

module.exports = { tool_result_summary, buildResultSummary, readTablePreview, pickPrimaryArtifact };
