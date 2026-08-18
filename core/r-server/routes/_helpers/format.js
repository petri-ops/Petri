'use strict';

/**
 * routes/_helpers/format.js — 响应格式化共享 helper
 *
 * 抽自 `core/r-server/routes/result-studio.js` PHASE 2.1a 拆分 commit。
 * 类别：响应侧（错误消息 / 错误响应）格式化，剥离敏感坐标信息。
 *   - publicResultStudioErrorMessage(error, fallback) → 私有错误坐标脱敏
 *   - sendArtifactResolutionError(res, error)        → 统一 JSON 响应
 *   - artifactTruthError(reason, message, code)      → 409 truth 错误构造
 *   - artifactTruthAvailability(result)              → 检查 truth 是否可用
 */

const PRIVATE_ERROR_COORDINATE = /(?:file:\/\/|[a-z]:[\\/]|\\\\|(?:^|[\s"'(:=])\/(?!api\/)[^\s"'<>]+)/i;

function publicResultStudioErrorMessage(error, fallback) {
  const message = String(error?.message || '').trim();
  if (!message || PRIVATE_ERROR_COORDINATE.test(message) || /[\r\n\0]/.test(message)) return fallback;
  return message.slice(0, 500);
}

function sendArtifactResolutionError(res, error) {
  const body = { error: error.code };
  if (error.reason) body.reason = error.reason;
  if (error.message) body.message = error.message;
  return res.status(error.status).json(body);
}

function artifactTruthError(reason, message, code = 'artifact_truth_unavailable') {
  return { error: { status: 409, code, reason, message } };
}

function artifactTruthAvailability(result) {
  const truth = result?.artifactTruth;
  if (!truth || truth.blocking === true || !['valid', 'degraded'].includes(truth.status)) {
    return artifactTruthError(
      'job_artifact_truth_unavailable',
      'The completed Job does not have usable Artifact Truth.',
    );
  }
  return null;
}

module.exports = {
  publicResultStudioErrorMessage,
  sendArtifactResolutionError,
  artifactTruthError,
  artifactTruthAvailability,
};
