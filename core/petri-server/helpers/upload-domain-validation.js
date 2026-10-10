'use strict';

/**
 * upload-domain-validation.js — BLOCK-131（G0-BIO BIO-5 P1）上传域校验执行化。
 *
 * 把 artifact-profiles.js 声明的两条数据 profile 的**值级规则**执行在
 * HTTP 上传路径（此前只有通用 CSV 嗅探：二进制/列数一致/大小上限——
 * 值级校验外包给 validator 插件，插件休眠期=校验真空）：
 *   petri.counts-matrix.v1 —— feature_ids_unique / counts_non_negative_integer
 *                             / sample_columns_present / sample_names_unique
 *   petri.sample-metadata.v1 —— sample_ids_unique / condition_not_missing
 *                             / sample_overlap_required（对绑定的矩阵）
 *
 * 识别策略（不猜语义）：按文件名约定识别域文件——counts 矩阵=输入名以
 * counts 开头；样本元数据=输入名以 metadata/coldata 开头（与 deseq2/
 * validator 插件的 jobDir 前缀约定同源）。其余文件不做域校验（通用嗅探
 * 已覆盖）。错误 fail-closed 且消息可操作：点名重复值/违规值/未对齐样本。
 */

const fs = require('fs');
const path = require('path');

const COUNTS_NAME = /^(counts|count_matrix|expression)[._-]/i;
const METADATA_NAME = /^(metadata|coldata|sample_?info)[._-]/i;
/** 大文件采样上限：超出后校验前 5 万数据行并如实标注采样。 */
const MAX_SCAN_ROWS = 50_000;

function parseCsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { header: [], rows: [], truncated: false };
  const delimiter = lines[0].includes('\t') && !lines[0].includes(',') ? '\t' : ',';
  const split = (line) => line.split(delimiter).map((cell) => cell.trim());
  const header = split(lines[0]);
  const scanLines = lines.slice(1, MAX_SCAN_ROWS + 1);
  return {
    header,
    rows: scanLines.map(split),
    truncated: lines.length - 1 > MAX_SCAN_ROWS,
  };
}

function isNonNegativeInteger(text) {
  if (!/^\d+$/.test(text)) return false;
  return true;
}

/**
 * @returns {{ findings: Array<{ file: string, code: string, message: string }> }}
 * findings 非空即应拒绝提交（fail-closed），message 均为可操作中文。
 */
function validateDomainUploads(jobDir, uploadedFileNames) {
  const findings = [];
  const names = Array.isArray(uploadedFileNames)
    ? uploadedFileNames.filter((n) => typeof n === 'string')
    : [];
  const countsName = names.find((n) => COUNTS_NAME.test(path.basename(n)));
  const metadataName = names.find((n) => METADATA_NAME.test(path.basename(n)));

  let countsColumns = null;
  if (countsName) {
    const filePath = path.join(jobDir, countsName);
    if (!fs.existsSync(filePath)) return { findings };
    const { header, rows, truncated } = parseCsv(filePath);
    countsColumns = header;

    // sample_columns_present：首列（feature id）之外至少一个样本列。
    if (header.length < 2) {
      findings.push({ file: countsName, code: 'sample_columns_present', message: `${countsName} 只有 ${header.length} 列——counts 矩阵至少需要「特征列 + 1 个样本列」。` });
    }
    // sample_names_unique：表头列名唯一。
    const seenCols = new Set();
    for (const col of header) {
      if (seenCols.has(col)) findings.push({ file: countsName, code: 'sample_names_unique', message: `${countsName} 的列名「${col}」重复——样本列必须唯一，请检查表头。` });
      seenCols.add(col);
    }
    // feature_ids_unique + counts_non_negative_integer（扫描有界）。
    const seenIds = new Map();
    let badValues = [];
    for (let r = 0; r < rows.length; r += 1) {
      const id = rows[r][0];
      if (id) {
        if (seenIds.has(id)) {
          findings.push({ file: countsName, code: 'feature_ids_unique', message: `${countsName} 的特征标识「${id}」重复（第 ${seenIds.get(id) + 2} 行与第 ${r + 2} 行）——基因/特征名必须唯一。` });
        } else {
          seenIds.set(id, r);
        }
      }
      for (let c = 1; c < header.length; c += 1) {
        const cell = rows[r][c];
        if (cell === '' || cell === undefined) continue;
        if (!isNonNegativeInteger(cell) && badValues.length < 5) {
          badValues.push(`「${cell}」（第 ${r + 2} 行 ${header[c]} 列）`);
        }
      }
    }
    if (badValues.length > 0) {
      findings.push({ file: countsName, code: 'counts_non_negative_integer', message: `${countsName} 含非「非负整数」的计数值：${badValues.join('、')}${truncated ? '（仅扫描前 ' + MAX_SCAN_ROWS + ' 行）' : ''}——原始 count 矩阵不允许负数/小数/文本；如已归一化请改用相应输入类型。` });
    }
  }

  if (metadataName) {
    const filePath = path.join(jobDir, metadataName);
    if (!fs.existsSync(filePath)) return { findings };
    const { header, rows } = parseCsv(filePath);
    const sampleIdx = header.findIndex((col) => /^(sample|sample_id)$/i.test(col));
    const condIdx = header.findIndex((col) => /^(condition|group|treatment)$/i.test(col));
    if (sampleIdx < 0) {
      findings.push({ file: metadataName, code: 'sample_column_missing', message: `${metadataName} 缺少样本标识列（sample）——表头需含 sample 或 sample_id。` });
    } else {
      const seen = new Map();
      let missing = [];
      for (let r = 0; r < rows.length; r += 1) {
        const id = rows[r][sampleIdx];
        if (id) {
          if (seen.has(id)) findings.push({ file: metadataName, code: 'sample_ids_unique', message: `${metadataName} 的样本「${id}」重复（第 ${seen.get(id) + 2} 行与第 ${r + 2} 行）。` });
          else seen.set(id, r);
        }
        if (condIdx >= 0 && (rows[r][condIdx] === '' || rows[r][condIdx] === undefined) && missing.length < 5) {
          missing.push(`第 ${r + 2} 行 ${id || '(空样本名)'}`);
        }
      }
      if (condIdx >= 0 && missing.length > 0) {
        findings.push({ file: metadataName, code: 'condition_not_missing', message: `${metadataName} 有样本缺少分组（condition）：${missing.join('、')}——每个样本都必须有实验分组。` });
      }
      // sample_overlap_required：与绑定的 counts 矩阵样本对齐。
      if (countsColumns) {
        const matrixSamples = new Set(countsColumns.slice(1));
        const notInMatrix = [...seen.keys()].filter((id) => !matrixSamples.has(id));
        if (notInMatrix.length > 0) {
          findings.push({ file: metadataName, code: 'sample_overlap_required', message: `${metadataName} 的样本 ${notInMatrix.slice(0, 5).map((s) => `「${s}」`).join('、')}${notInMatrix.length > 5 ? ` 等 ${notInMatrix.length} 个` : ''}在 ${countsName} 的列中不存在——样本表与矩阵必须一一对应。` });
        }
        const notInMetadata = [...matrixSamples].filter((id) => !seen.has(id));
        if (notInMetadata.length > 0) {
          findings.push({ file: countsName, code: 'sample_overlap_required', message: `${countsName} 的样本列 ${notInMetadata.slice(0, 5).map((s) => `「${s}」`).join('、')}${notInMetadata.length > 5 ? ` 等 ${notInMetadata.length} 个` : ''}在 ${metadataName} 中没有对应行——矩阵与样本表必须一一对应。` });
        }
      }
    }
  }
  return { findings };
}

module.exports = { validateDomainUploads, COUNTS_NAME, METADATA_NAME };
