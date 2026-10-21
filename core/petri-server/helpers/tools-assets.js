const fs = require('fs');
const path = require('path');
const {safeJoinUnder} = require('../../shared-backend/path-safe');
const {sendThemedHtmlFile} = require('./report-theme');
const {loadPublicDemoAssets} = require('./pack-demo-assets');

// Published demo assets are immutable local job output directories. They must
// remain visible even if the mutable tool_jobs table is re-migrated, truncated,
// or no longer carries is_public flags. The catalog is domain data owned by the
// installed pack (`provides.demoAssets`), read at startup.
const PUBLIC_DEMO_ASSETS = Object.freeze(loadPublicDemoAssets().assets);
const PUBLIC_DEMO_JOB_IDS = new Set(Object.values(PUBLIC_DEMO_ASSETS));

// safeJoinUnder is imported from shared-backend/path-safe above.

function detectOutputType(name) {
  if (/\.(png|jpg|jpeg|gif|svg)$/i.test(name)) return 'plot';
  if (/\.(csv|tsv)$/i.test(name)) return 'table';
  if (/\.txt$/i.test(name)) return 'text';
  return 'file';
}

function filesForPublicJob(jobId, result) {
  return (result.files || []).map((f) => ({...f, url: '/tools/public-file/' + jobId + '/' + f.name}));
}

function createToolsAssetHandlers({
  db,
  jobsDir,
  toolDemoResultsDir = '',
  toolDemoDataDir = '',
  staticDemoEnabled = false,
}) {
  function readPublicDemoAsset(toolId) {
    const jobId = PUBLIC_DEMO_ASSETS[toolId];
    if (!jobId) return null;
    const outputDir = safeJoinUnder(jobsDir, jobId, 'output');
    if (!outputDir || !fs.existsSync(outputDir)) return null;

    let result = null;
    const manifestPath = path.join(outputDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      try { result = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch {}
    }
    if (!result || !Array.isArray(result.files)) {
      const files = fs.readdirSync(outputDir).filter((name) => name !== 'manifest.json');
      result = {
        files: files.map((name) => ({name, type: detectOutputType(name)})),
      };
    }
    return {jobId, result, files: filesForPublicJob(jobId, result)};
  }

  async function handlePublicDemo(req, res) {
    try {
      const job = await db.prepare('SELECT * FROM tool_jobs WHERE tool_id = ? AND is_public = 1 AND status = ?').get(req.params.toolId, 'completed');
      if (!job) {
        const demoAsset = readPublicDemoAsset(req.params.toolId);
        if (demoAsset) {
          return res.json({
            ok: true,
            toolId: req.params.toolId,
            jobId: demoAsset.jobId,
            files: demoAsset.files,
            summary: demoAsset.result.summary,
            source: 'asset',
          });
        }
        if (staticDemoEnabled) {
          const dir = path.join(toolDemoResultsDir, req.params.toolId);
          if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir).map((f) => ({name: f, type: f.endsWith('.png') ? 'plot' : f.endsWith('.csv') ? 'table' : 'file', url: '/tools/demo/' + req.params.toolId + '/' + f}));
            return res.json({ok: true, toolId: req.params.toolId, files, source: 'static'});
          }
        }
        // 插件 demo 数据：从已装插件的 demo-data/ 目录读
        try {
          const { getDemoDataDir } = require('../plugin-loader');
          const pluginDemoDir = getDemoDataDir(req.params.toolId);
          if (pluginDemoDir && fs.existsSync(pluginDemoDir)) {
            const files = fs.readdirSync(pluginDemoDir).map((f) => ({
              name: f,
              type: detectOutputType(f),
              url: '/tools/demo/' + req.params.toolId + '/' + f,
            }));
            return res.json({ok: true, toolId: req.params.toolId, files, source: 'plugin'});
          }
        } catch {}
        return res.json({ok: true, files: [], source: 'none'});
      }
      const result = job.result_json ? JSON.parse(job.result_json) : {files: []};
      const files = filesForPublicJob(job.id, result);
      res.json({ok: true, toolId: req.params.toolId, jobId: job.id, files, summary: result.summary, source: 'job'});
    } catch (e) {
      res.status(500).json({error: e.message});
    }
  }

  async function handlePublicFile(req, res) {
    try {
      const job = await db.prepare('SELECT * FROM tool_jobs WHERE id = ? AND is_public = 1').get(req.params.jobId);
      if (!job && !PUBLIC_DEMO_JOB_IDS.has(req.params.jobId)) return res.status(404).json({error: 'not_found'});
      const filePath = safeJoinUnder(jobsDir, req.params.jobId, 'output', req.params.filename);
      if (!filePath) return res.status(400).json({error: 'bad_path'});
      if (!fs.existsSync(filePath)) return res.status(404).json({error: 'file_not_found'});
      if (sendThemedHtmlFile(req, res, filePath)) return;
      res.sendFile(filePath);
    } catch (e) {
      res.status(500).json({error: e.message});
    }
  }

  function handleDemoData(req, res) {
    // 1. 静态 demo 目录（web 版 legacy）
    if (staticDemoEnabled) {
      const filePath = safeJoinUnder(toolDemoDataDir, req.params.toolId, req.params.filename);
      if (filePath && fs.existsSync(filePath)) return res.sendFile(filePath);
    }
    // 2. 插件 demo-data/ 目录（桌面版已装插件）
    try {
      const { getDemoDataDir } = require('../plugin-loader');
      const pluginDemoDir = getDemoDataDir(req.params.toolId);
      if (pluginDemoDir) {
        const filePath = safeJoinUnder(pluginDemoDir, req.params.filename);
        if (filePath && fs.existsSync(filePath)) return res.sendFile(filePath);
      }
    } catch {}
    return res.status(404).json({error: 'not_found'});
  }

  function handleLegacyDemoFile(req, res) {
    // 1. 静态 demo 目录（web 版 legacy）
    if (staticDemoEnabled) {
      const filePath = safeJoinUnder(toolDemoResultsDir, req.params.toolId, req.params.filename);
      if (filePath && fs.existsSync(filePath)) return res.sendFile(filePath);
    }
    // 2. 插件 demo-data/（桌面版已装插件）
    try {
      const { getDemoDataDir } = require('../plugin-loader');
      const pluginDemoDir = getDemoDataDir(req.params.toolId);
      if (pluginDemoDir) {
        const filePath = safeJoinUnder(pluginDemoDir, req.params.filename);
        if (filePath && fs.existsSync(filePath)) return res.sendFile(filePath);
      }
    } catch {}
    return res.status(404).json({error: 'not_found'});
  }

  function handleLegacyDemoList(req, res) {
    if (staticDemoEnabled) {
      const dir = safeJoinUnder(toolDemoResultsDir, req.params.toolId);
      if (dir && fs.existsSync(dir)) {
        const files = fs.readdirSync(dir).map((f) => ({
          name: f,
          type: f.endsWith('.png') ? 'plot' : f.endsWith('.csv') ? 'table' : 'file',
          url: '/tools/demo/' + req.params.toolId + '/' + f,
        }));
        return res.json({ok: true, toolId: req.params.toolId, files});
      }
    }
    // 插件 demo-data/（桌面版已装插件）
    try {
      const { getDemoDataDir } = require('../plugin-loader');
      const pluginDemoDir = getDemoDataDir(req.params.toolId);
      if (pluginDemoDir && fs.existsSync(pluginDemoDir)) {
        const files = fs.readdirSync(pluginDemoDir).map((f) => ({
          name: f,
          type: detectOutputType(f),
          url: '/tools/demo/' + req.params.toolId + '/' + f,
        }));
        return res.json({ok: true, toolId: req.params.toolId, files, source: 'plugin'});
      }
    } catch {}
    return res.json({ok: true, toolId: req.params.toolId, files: [], source: 'none'});
  }

  return {
    readPublicDemoAsset,
    handlePublicDemo,
    handlePublicFile,
    handleDemoData,
    handleLegacyDemoFile,
    handleLegacyDemoList,
  };
}

module.exports = {
  PUBLIC_DEMO_ASSETS,
  PUBLIC_DEMO_JOB_IDS,
  safeJoinUnder,
  detectOutputType,
  filesForPublicJob,
  createToolsAssetHandlers,
};
