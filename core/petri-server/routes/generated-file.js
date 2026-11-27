'use strict';

/**
 * 生成产物受控读面（item 83）。
 *
 * generate.* 产物落在 <dataDir>/generated/generate-<kind>，既不在 workspace 也不在
 * tool job dir，既有两条读面取不到。这里给出单一 URL 真值与 fail-closed 文件读面：
 * kind 白名单 + 扁平文件名 + 根内校验 + 真实文件，越界一律 400/404。
 */
const { contentTypeFor } = require('../helpers/content-type');
// 路径/URL 校验单一真值在 shared-backend（src→core/shared-backend 是合法架构边）。
const {
  buildGeneratedArtifactUrl,
  resolveGeneratedArtifactPath,
} = require('../../shared-backend/generated-artifact-path');

function registerGeneratedFileRoutes(app) {
  app.get('/api/generated/file/:kind/:filename', (req, res) => {
    const filePath = resolveGeneratedArtifactPath(req.params.kind, req.params.filename);
    if (!filePath) return res.status(404).json({ error: 'generated_file_not_found' });
    // item83 返工：HTML 必须显式 UTF-8，否则文件查看面按系统默认编码 guesses → 中文乱码。
    const contentType = contentTypeFor(filePath);
    res.setHeader('Content-Type', contentType === 'text/html' ? 'text/html; charset=utf-8' : contentType);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.sendFile(filePath);
  });
}

module.exports = {
  buildGeneratedArtifactUrl,
  resolveGeneratedArtifactPath,
  registerGeneratedFileRoutes,
};
