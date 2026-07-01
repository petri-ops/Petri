// ============================================================
// R Error Translator — 把常见 R 报错翻译成人话
// ============================================================

interface ErrorTranslation {
  /** 中文描述 */
  message: string;
  /** 解决建议 */
  suggestion: string;
  /** 严重程度 */
  severity: 'error' | 'warning' | 'info';
}

const ERROR_PATTERNS: Array<{
  pattern: RegExp;
  translate: (match: RegExpMatchArray) => ErrorTranslation;
}> = [
  // ---- 数据格式问题 ----
  {
    pattern: /Barcode file missing/i,
    translate: () => ({
      message: '找不到 barcodes 文件',
      suggestion:
        '上传的 tar.gz 需要包含 barcodes.tsv.gz、features.tsv.gz、matrix.mtx.gz 三个文件。请检查压缩包结构。',
      severity: 'error',
    }),
  },
  {
    pattern: /invalid class "LogMap" object.*Rownames must be supplied/i,
    translate: () => ({
      message: '矩阵格式错误：缺少行名（基因名）',
      suggestion:
        '上传的文件可能不是标准的 10x 格式。请确保矩阵文件包含基因名信息，或使用 .rds 格式上传已处理的 Seurat 对象。',
      severity: 'error',
    }),
  },
  {
    pattern: /cannot open URL.*HTTP status was '404/i,
    translate: () => ({
      message: '数据文件下载失败（404）',
      suggestion: '文件可能已被删除或链接失效。请重新上传数据。',
      severity: 'error',
    }),
  },
  {
    pattern: /cannot open connection|cannot open URL/i,
    translate: () => ({
      message: '无法下载数据文件',
      suggestion: '网络连接问题或文件链接失效。请稍后重试，或重新上传数据。',
      severity: 'error',
    }),
  },
  {
    pattern: /embedded nul\(s\) found in input/i,
    translate: () => ({
      message: '文件包含无效字符（二进制文件被当作文本读取）',
      suggestion: '请确认上传的是正确格式的文件。如果是 .rds 文件，不要重命名为 .csv。',
      severity: 'error',
    }),
  },
  {
    pattern: /Data is of class data\.frame.*Coercing to dgCMatrix/i,
    translate: () => ({
      message: '数据格式自动转换中',
      suggestion: '这是一个警告，不影响分析。系统正在将 data.frame 转换为稀疏矩阵。',
      severity: 'warning',
    }),
  },
  {
    pattern: /Feature names cannot have underscores/i,
    translate: () => ({
      message: '基因名包含下划线，已自动替换为短横线',
      suggestion: '这是 Seurat 的限制，不影响分析结果。',
      severity: 'warning',
    }),
  },

  // ---- 内存/资源问题 ----
  {
    pattern: /cannot allocate vector of size/i,
    translate: () => ({
      message: '内存不足',
      suggestion:
        '数据集太大，服务器内存不够。建议：1) 减少细胞数量（取子集）2) 降低 max.features 参数 3) 联系管理员扩容。',
      severity: 'error',
    }),
  },
  {
    pattern: /Error.*Execution halted/i,
    translate: (_m) => ({
      message: 'R 脚本执行中断',
      suggestion: '分析过程中遇到错误。请检查数据格式是否正确，或尝试调整参数后重新提交。',
      severity: 'error',
    }),
  },

  // ---- Seurat 相关 ----
  {
    pattern: /No features found in.*common/i,
    translate: () => ({
      message: '样本间没有共同基因',
      suggestion: '多样本整合时，各样本的基因名不一致。请确认所有样本使用相同的参考基因组。',
      severity: 'error',
    }),
  },
  {
    pattern: /Cannot find.*reduction/i,
    translate: () => ({
      message: '找不到降维结果',
      suggestion: '需要先运行 PCA/UMAP 降维。请确保标准分析已完成。',
      severity: 'error',
    }),
  },
  {
    pattern: /object '(\w+)' not found/i,
    translate: (m) => ({
      message: `变量 "${m[1]}" 不存在`,
      suggestion: '分析脚本中引用了不存在的变量。可能是数据加载失败或参数配置错误。请重新提交。',
      severity: 'error',
    }),
  },
  {
    pattern: /subscript out of bounds/i,
    translate: () => ({
      message: '数组越界',
      suggestion: '指定的 cluster 编号或分组不存在。请检查参数中的分组名称是否正确。',
      severity: 'error',
    }),
  },

  // ---- 超时 ----
  {
    pattern: /分析超时/i,
    translate: () => ({
      message: '分析超时',
      suggestion:
        '数据集太大或参数设置导致计算时间过长。建议：1) 减少细胞数 2) 降低 nPCs 3) 取子集后再分析。',
      severity: 'error',
    }),
  },

  // ---- 任务中断 ----
  {
    pattern: /服务重启时此任务被中断/i,
    translate: () => ({
      message: '服务重启导致任务中断',
      suggestion: '服务器维护期间任务被中断。请重新提交分析。',
      severity: 'info',
    }),
  },

  // ---- 未知任务类型 ----
  {
    pattern: /未知任务类型:\s*(\w+)/i,
    translate: (m) => ({
      message: `不支持的分析类型：${m[1]}`,
      suggestion: '该分析类型尚未实现或配置错误。请联系管理员。',
      severity: 'error',
    }),
  },

  // ---- 包版本问题 ----
  {
    pattern: /package '(\w+)' was built under R version/i,
    translate: (m) => ({
      message: `R 包 ${m[1]} 版本警告`,
      suggestion: '这只是版本兼容性警告，通常不影响分析结果。',
      severity: 'warning',
    }),
  },

  // ---- Monocle3 / 轨迹分析 ----
  {
    pattern: /No root cells specified/i,
    translate: () => ({
      message: '未指定根细胞',
      suggestion: '轨迹分析需要指定起始 cluster。请在参数中设置 root cluster。',
      severity: 'error',
    }),
  },

  // ---- CellChat / 通讯分析 ----
  {
    pattern: /No significant interactions/i,
    translate: () => ({
      message: '未检测到显著的细胞间通讯',
      suggestion:
        '可能是细胞类型注释不够精确，或样本中细胞间互作较弱。建议先做细胞注释再进行通讯分析。',
      severity: 'info',
    }),
  },
];

/**
 * Translate an R error message to user-friendly Chinese.
 * Returns null if no matching pattern found.
 */
export function translateError(rawError: string): ErrorTranslation | null {
  if (!rawError) return null;
  for (const { pattern, translate } of ERROR_PATTERNS) {
    const match = rawError.match(pattern);
    if (match) return translate(match);
  }
  return null;
}

/**
 * Get a short summary of the error (first meaningful line).
 */
export function getErrorSummary(rawError: string, maxLen = 80): string {
  if (!rawError) return '未知错误';
  // Remove R warning lines and get the actual error
  const lines = rawError
    .split('\n')
    .filter(
      (l) =>
        l.trim() &&
        !l.startsWith('Warning') &&
        !l.includes('was built under R version') &&
        !l.includes('Loading required package')
    );
  const errorLine = lines.find((l) => l.includes('Error')) || lines[lines.length - 1] || rawError;
  return errorLine.length > maxLen ? errorLine.slice(0, maxLen) + '...' : errorLine;
}
