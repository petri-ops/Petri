/**
 * task-scripts-gen/_load-code.js — shared R readRDS loading code generator
 */
const {sanitizeRString} = require('../sanitizer');

function generateLoadCode(task, _progressHelper) {
  const { ossInputUrl, _containerWorkDir, parentCachePath } = task;

  // M1-3 (H2)：插值进 R "..." 的用户输入转义
  const safeOssInputUrl = sanitizeRString(ossInputUrl);
  const safeParentCachePath = sanitizeRString(parentCachePath);
  if (!safeOssInputUrl) {
    throw new Error('非法参数：含危险字符');
  }

  if (parentCachePath) {
    // Use local cache — no download needed
    return `
report_progress(10, "从本地缓存加载数据...")
obj <- readRDS("${safeParentCachePath}")
report_progress(20, paste0("加载完成: ", ncol(obj), " 细胞"))
`;
  }

  // Fallback: download from OSS
  return `
report_progress(10, "下载数据...")
input_url <- "${safeOssInputUrl}"
download.file(input_url, "input.rds", mode = "wb", quiet = TRUE)
obj <- readRDS("input.rds")
report_progress(20, paste0("加载完成: ", ncol(obj), " 细胞"))
`;
}

/**
 * Generate R script based on task type.
 */

module.exports = { generateLoadCode };
