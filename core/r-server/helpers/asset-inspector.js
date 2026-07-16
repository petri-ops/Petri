const fs = require('fs');
const path = require('path');
const {humanSize} = require('../cache-manager');

const JOBS_DIR = '/mnt/storage_16tb/omichub/biof3-tool-jobs';

// Keep in sync with routes/tools.js. These are immutable published demo assets
// on the Dell compute volume, independent of mutable tool_jobs rows.
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

function detectOutputType(name) {
  if (/\.(png|jpg|jpeg|gif|svg)$/i.test(name)) return 'plot';
  if (/\.(csv|tsv)$/i.test(name)) return 'table';
  if (/\.html?$/i.test(name)) return 'report';
  if (/\.pdf$/i.test(name)) return 'pdf';
  if (/\.(txt|log)$/i.test(name)) return 'text';
  return 'file';
}

function scanFlatDir(dir) {
  const files = [];
  let totalBytes = 0;
  let newestMtime = 0;
  if (!fs.existsSync(dir)) return {exists: false, files, totalBytes, newestMtime: null};
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) {
    return {exists: true, files, totalBytes, newestMtime: null, error: e.message};
  }
  for (const name of names) {
    const full = path.join(dir, name);
    let st;
    try { st = fs.lstatSync(full); } catch { continue; }
    if (!st.isFile() && !st.isSymbolicLink()) continue;
    totalBytes += st.size;
    newestMtime = Math.max(newestMtime, st.mtimeMs || 0);
    files.push({
      name,
      type: detectOutputType(name),
      sizeBytes: st.size,
      sizeHuman: humanSize(st.size),
      mtime: st.mtime.toISOString(),
    });
  }
  files.sort((a, b) => b.sizeBytes - a.sizeBytes);
  return {
    exists: true,
    files,
    totalBytes,
    totalHuman: humanSize(totalBytes),
    newestMtime: newestMtime ? new Date(newestMtime).toISOString() : null,
  };
}

function readManifest(outputDir) {
  const manifestPath = path.join(outputDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return {exists: false, valid: false, fileCount: 0, error: null};
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return {
      exists: true,
      valid: true,
      fileCount: Array.isArray(manifest.files) ? manifest.files.length : 0,
      hasSummary: !!manifest.summary,
      error: null,
    };
  } catch (e) {
    return {exists: true, valid: false, fileCount: 0, hasSummary: false, error: e.message};
  }
}

function inspectJobDir(jobId) {
  const jobDir = path.join(JOBS_DIR, jobId);
  const outputDir = path.join(jobDir, 'output');
  const output = scanFlatDir(outputDir);
  const manifest = output.exists ? readManifest(outputDir) : {exists: false, valid: false, fileCount: 0, error: null};
  const hasRunLog = output.files.some((f) => f.name === 'run.log');
  return {
    jobId,
    jobDir,
    outputDir,
    exists: fs.existsSync(jobDir),
    outputExists: output.exists,
    fileCount: output.files.length,
    totalBytes: output.totalBytes || 0,
    totalHuman: output.totalHuman || humanSize(0),
    newestMtime: output.newestMtime,
    manifest,
    hasRunLog,
    topFiles: output.files.slice(0, 8),
    error: output.error || null,
  };
}

function inspectPublicDemos() {
  return Object.entries(PUBLIC_DEMO_ASSETS).map(([toolId, jobId]) => {
    const item = inspectJobDir(jobId);
    const ok = item.exists && item.outputExists && item.fileCount > 0 && (!item.manifest.exists || item.manifest.valid);
    return {
      toolId,
      source: 'asset',
      publicDemoUrl: `/api/platform/tools/public-demo/${toolId}`,
      publicFilePrefix: `/api/platform/tools/public-file/${jobId}/`,
      ok,
      ...item,
    };
  }).sort((a, b) => a.toolId.localeCompare(b.toolId));
}

function inspectRecentJobs(limit = 30) {
  if (!fs.existsSync(JOBS_DIR)) return [];
  let names = [];
  try { names = fs.readdirSync(JOBS_DIR); } catch { return []; }
  const jobs = [];
  for (const name of names) {
    if (!/^job_[a-z0-9]+$/i.test(name)) continue;
    const item = inspectJobDir(name);
    jobs.push({
      ...item,
      isPublicDemo: PUBLIC_DEMO_JOB_IDS.has(name),
    });
  }
  jobs.sort((a, b) => new Date(b.newestMtime || 0).getTime() - new Date(a.newestMtime || 0).getTime());
  return jobs.slice(0, limit);
}

function getAssetInspection() {
  const demos = inspectPublicDemos();
  const recentJobs = inspectRecentJobs(30);
  const missingDemos = demos.filter((d) => !d.ok);
  return {
    host: require('os').hostname(),
    timestamp: new Date().toISOString(),
    jobsDir: JOBS_DIR,
    summary: {
      demoCount: demos.length,
      demoOk: demos.length - missingDemos.length,
      demoMissing: missingDemos.length,
      recentJobs: recentJobs.length,
    },
    demos,
    recentJobs,
  };
}

module.exports = {getAssetInspection, PUBLIC_DEMO_ASSETS, JOBS_DIR};
