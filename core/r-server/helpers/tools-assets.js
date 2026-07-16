const fs = require('fs');
const path = require('path');
const {safeJoinUnder} = require('../../shared-backend/path-safe');
const {sendThemedHtmlFile} = require('./report-theme');

// Published demo assets are immutable job output directories on the Dell
// compute volume. They must remain visible even if the mutable tool_jobs table
// is re-migrated, truncated, or no longer carries is_public flags.
const PUBLIC_DEMO_ASSETS = Object.freeze({
  'bindea-immune': 'job_bdd759f1fd7a46f1',
  'cellchat': 'job_ead4e18425474378',
  'complexheatmap': 'job_0f96125f0ce14383',
  'consensus-cluster': 'job_37962f3e447042fc',
  'deseq2': 'job_5c2047cb727e4d42',
  'go-kegg': 'job_0b3ab56c34e14d54',
  'gsea': 'job_03771538de544ada',
  'km-survival': 'job_0bccfb3f75474997',
  'lasso-cox': 'job_997f1ba968c643c8',
  'maftools-mutation': 'job_c819c467e7444f0b',
  'ml-classifier': 'job_e3ab53e47a2e477b',
  'ml-feature-select': 'job_94049d598ea84196',
  'mo-mofa': 'job_6f4ca958b32e49ce',
  'mo-snf': 'job_604a169b32924e73',
  'rsf-survival': 'job_9410db5b7eb6484d',
  'seurat-standard': 'job_aed0a50d2d524ef9',
  'shap-explain': 'job_96a2debf102c42e4',
  'spatial-deconv': 'job_a9701b22bc144c34',
  'spatial-lr': 'job_b53a8136d7584d5d',
  'spatial-standard': 'job_1d8b2aff0ddd46cd',
  'spatial-svg': 'job_bfa695b75eff4663',
  'wgcna': 'job_06d7ea08cf4f4bb5',
});

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
