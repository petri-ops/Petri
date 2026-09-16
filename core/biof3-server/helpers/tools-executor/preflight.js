'use strict';

const fs = require('fs');
const {
  interpreterLabel,
  missingRuntimeCommandName,
} = require('../../../shared-backend/script-host-languages');
const { resolveLifecycleDurations } = require('../process-lifecycle');

const TOOL_LIFECYCLE = resolveLifecycleDurations();
const ZOMBIE_TIMEOUT_MS = TOOL_LIFECYCLE.zombieTimeoutMs;
const HEARTBEAT_INTERVAL_MS = TOOL_LIFECYCLE.heartbeatIntervalMs;

const R_ERROR_TRANSLATIONS = [
  {
    pattern: /more columns than column names/i,
    msg: 'CSV 格式错误：列数不一致。请检查文件是否有多余的逗号，或者表头列数与数据列数不匹配。',
  },
  {
    pattern: /cannot open the connection|No such file or directory/i,
    msg: '文件读取失败：请确认上传的文件格式正确且未损坏。',
  },
  {
    pattern: /object '(\w+)' not found/i,
    msg: (m) => `数据中缺少必需的列或变量："${m[1]}"。请检查输入文件的列名是否正确。`,
  },
  {
    pattern: /cannot allocate vector of size/i,
    msg: '内存不足：数据太大，超出服务器内存限制(4GB)。建议：减少基因数或样本数后重试。',
  },
  {
    pattern: /there is no package called '(\w+)'/i,
    msg: (m) => `服务器缺少 R 包 "${m[1]}"，请联系管理员安装。`,
  },
  {
    pattern: /replacement has (\d+) rows, data has (\d+)/i,
    msg: '数据维度不匹配：行数不一致。请检查输入文件的样本数是否与实验设计一致。',
  },
  {
    pattern: /undefined columns selected/i,
    msg: '列名不存在：请检查参数中指定的列名是否在数据文件中存在（注意大小写）。',
  },
  {
    pattern: /duplicate 'row\.names'/i,
    msg: '行名重复：数据文件中有重复的基因名或样本名，请去重后重新上传。',
  },
  {
    pattern: /non-numeric argument to binary operator/i,
    msg: '数据类型错误：某些应该是数字的列包含了文本。请检查数据文件中是否有非数字字符（如 "NA" 文本、空格、特殊符号）。',
  },
  {
    pattern: /subscript out of bounds/i,
    msg: '数据索引越界：可能是筛选条件过严导致结果为空。请放宽筛选阈值（如降低 padj 或 log2FC 要求）后重试。',
  },
  {
    pattern: /Killed|exit code 137/i,
    msg: '任务被系统终止（内存超限）：数据量超出服务器容量。建议：减少输入数据量或联系管理员。',
  },
  {
    pattern: /timeout|timed out/i,
    msg: '分析超时（超过 5 分钟）：数据量可能过大。建议：减少基因数/样本数，或选择更快的分析参数。',
  },
  {
    pattern: /colData.*must have the same number/i,
    msg: 'coldata 与 counts 样本数不匹配：请确认 coldata 的行数等于 counts 的列数，且样本名一致。',
  },
  {
    pattern: /design matrix.*not full rank/i,
    msg: '实验设计矩阵不满秩：可能是某个分组只有 1 个样本，或分组变量有完全共线的列。请检查 coldata。',
  },
];

// BLOCK-66 P1 — runtime preflight：executor.binPath 是路径字符串（executor
// 解析失败会回退 PATH 搜索仍返回字符串），必须 existsSync 校验；R/Python
// 运行时未安装时诚实失败 + 商店指引（而非裸 spawn ENOENT）。纯函数便于测试。
function evaluateRuntimePreflight(executor, lang) {
  const binPath = executor && executor.binPath;
  const binExists = !!(binPath && require('node:fs').existsSync(binPath));
  if (executor && binPath && binExists) {
    return { runtime: lang || null, ready: true, command: binPath, reason: null };
  }
  const label = interpreterLabel(lang);
  if (!executor) {
    return { runtime: lang || null, ready: false, command: null, reason: `未找到 ${lang || 'unknown'} 执行器` };
  }
  // P3 实机实证：隔离无 R 环境下 binPath 可能为 null（PATH 搜索无果），
  // 此时同样是"运行时未安装"，必须给商店指引而非含糊的"未找到执行器"。
  const where = binPath
    ? `可执行文件不存在：${binPath}`
    : `未找到 ${missingRuntimeCommandName(lang)}`;
  return {
    runtime: lang || null,
    ready: false,
    command: null,
    reason: `${label} 分析运行时未安装（${where}）。`
      + '请在「插件商店 → 运行时」安装对应分析运行时后重试（安装后需重启应用）。',
  };
}


module.exports = {
  TOOL_LIFECYCLE,
  ZOMBIE_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
  R_ERROR_TRANSLATIONS,
  evaluateRuntimePreflight,
};
