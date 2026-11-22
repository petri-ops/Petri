#!/usr/bin/env node
'use strict';

/**
 * Disposable Electron-side observer for the bounded P6 pressure prototype.
 * Runtime coordinates stay in the private config file. The result contains
 * only counts, timings, dimensions and digests suitable for later evidence.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const { createHash } = require('node:crypto');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { probeUrl } = require('../src/backend-health.js');
// P6 harness 补 pack handler（2026-11-22）：复用产品主进程 scheme.js 单源，
// 让隔离压测 driver 也能服务 iframe 的 petri-pack:// URL（只读 handler，
// 仅 harness 协议能力；不改产品 sandbox/CSP/凭据/B1 token）。
const { registerPackSchemePrivileges, setupPackProtocol } = require('../src/main/pack-ui/scheme');

const CONFIG_ENV = 'PETRI_P6_PRESSURE_DRIVER_CONFIG';
const PRELOAD_PATH = path.resolve(__dirname, '..', 'src', 'preload.js');
const requestedWaitMs = Number(process.env.PETRI_P6_PRESSURE_WAIT_MS);
const WAIT_MS = Number.isFinite(requestedWaitMs) && requestedWaitMs >= 5_000
  ? requestedWaitMs
  : 120_000;
const POLL_MS = 100;
const BACKEND_STATUS_TIMEOUT_MS = 1_500;

app.commandLine.appendSwitch('js-flags', '--expose-gc');

const disposableConfigPath = process.env[CONFIG_ENV];
if (!disposableConfigPath || !path.isAbsolute(disposableConfigPath)) {
  throw new Error(`${CONFIG_ENV} must be an absolute disposable path`);
}
const disposableUserData = path.join(path.dirname(disposableConfigPath), 'electron-user-data');
mkdirSync(disposableUserData, { recursive: true, mode: 0o700 });
app.setPath('userData', disposableUserData);
// 必须在 app ready 前注册 scheme privileges（Electron 硬约束）；复用产品单源，
// Privileges 含裁决 A（supportFetchAPI/corsEnabled），与产品主窗完全同形。
registerPackSchemePrivileges();

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readConfig() {
  const configPath = process.env[CONFIG_ENV];
  if (!configPath || !path.isAbsolute(configPath)) {
    throw new Error(`${CONFIG_ENV} must be an absolute disposable path`);
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  for (const key of ['uiBaseUrl', 'backendBaseUrl', 'projectId', 'conversationId', 'resultPath']) {
    if (typeof config[key] !== 'string' || !config[key]) throw new Error(`missing config field: ${key}`);
  }
  const loopback = (value, label) => {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port || parsed.pathname !== '/') {
      throw new Error(`${label} must be an isolated loopback origin`);
    }
    return parsed;
  };
  const ui = loopback(config.uiBaseUrl, 'uiBaseUrl');
  const backend = loopback(config.backendBaseUrl, 'backendBaseUrl');
  if (ui.port === backend.port) throw new Error('UI and backend ports must differ');
  if (String(process.env.R_SERVER_PORT || '') !== backend.port) {
    throw new Error('backendBaseUrl must match the Electron preload backend port');
  }
  if (!path.isAbsolute(config.resultPath)
      || path.dirname(config.resultPath) !== path.dirname(disposableConfigPath)) {
    throw new Error('resultPath must stay beside the disposable driver config');
  }
  for (const name of ['table', 'png', 'svg', 'report']) {
    const target = config.targets?.[name];
    if (!target || typeof target.jobId !== 'string' || typeof target.artifact !== 'string'
        || typeof target.label !== 'string' || !target.label) {
      throw new Error(`missing target: ${name}`);
    }
  }
  return config;
}

function targetUrl(config, target, mode = 'result') {
  return `${config.uiBaseUrl}/project/${encodeURIComponent(config.projectId)}`
    + `/${encodeURIComponent(mode)}?job=${encodeURIComponent(target.jobId)}`
    + `&artifact=${encodeURIComponent(target.artifact)}`;
}

function parseToolFileIdentity(value) {
  try {
    const parsed = new URL(value);
    const match = parsed.pathname.match(/\/tools\/file\/([^/]+)\/([^/]+)$/);
    if (!match) return null;
    return {
      parsed,
      jobId: decodeURIComponent(match[1]),
      artifact: decodeURIComponent(match[2]),
    };
  } catch {
    return null;
  }
}

function matchesToolFileTarget(value, target) {
  const identity = parseToolFileIdentity(value);
  return Boolean(identity
    && identity.jobId === target.jobId
    && identity.artifact === target.artifact);
}

function registerBackendStatusHandler(config) {
  const healthUrl = new URL('/api/health', config.backendBaseUrl).toString();
  const observations = [];
  ipcMain.handle('backend:status', async () => {
    const started = performance.now();
    const rServerUp = await probeUrl(healthUrl, BACKEND_STATUS_TIMEOUT_MS);
    observations.push({
      ready: rServerUp,
      durationMs: performance.now() - started,
    });
    return {
      rRuntime: rServerUp,
      pyRuntime: false,
      rServerUp,
      isReady: rServerUp,
      downReason: rServerUp ? null : '本地分析服务尚未就绪',
    };
  });
  return () => ({
    checkCount: observations.length,
    everyCheckReady: observations.length > 0
      && observations.every((observation) => observation.ready === true),
    maxDurationMs: observations.length > 0
      ? Math.max(...observations.map((observation) => observation.durationMs))
      : null,
  });
}

function registerIsolatedCompatibilityHandlers() {
  const observations = {
    aiSettingsReadCount: 0,
    terminalResizeCount: 0,
    terminalStopCount: 0,
  };
  ipcMain.handle('ai-settings:get', async () => {
    observations.aiSettingsReadCount += 1;
    return {};
  });
  ipcMain.handle('terminal:session-resize', async () => {
    observations.terminalResizeCount += 1;
    return { ok: false, error: 'terminal_not_exercised_by_pressure_trace' };
  });
  ipcMain.handle('terminal:session-stop', async () => {
    observations.terminalStopCount += 1;
    return { ok: true, wasRunning: false };
  });
  return () => ({ ...observations });
}

function registerArtifactNetworkObservation(webContents, config) {
  const backend = new URL(config.backendBaseUrl);
  const targets = Object.entries(config.targets);
  const events = [];
  const classify = (details, outcome) => {
    const identity = parseToolFileIdentity(details.url);
    if (!identity) return;
    const isBackendLoopback = identity.parsed.protocol === 'http:'
      && ['127.0.0.1', 'localhost', '[::1]'].includes(identity.parsed.hostname)
      && identity.parsed.port === backend.port;
    if (!isBackendLoopback) return;
    const matchedTargets = targets
      .filter(([, target]) => identity.jobId === target.jobId && identity.artifact === target.artifact)
      .map(([name]) => name);
    if (matchedTargets.length === 0) return;
    events.push({
      artifactName: identity.artifact,
      matchedTargets,
      outcome,
      resourceType: details.resourceType || 'unknown',
      statusCode: Number.isFinite(details.statusCode) ? details.statusCode : null,
      fromCache: details.fromCache === true,
      error: outcome === 'error' ? String(details.error || 'unknown').slice(0, 160) : null,
    });
    if (events.length > 40) events.shift();
  };
  // The preload API origin is intentionally loopback-only, but the renderer
  // may spell the same host as either localhost or 127.0.0.1. Observe all
  // requests in this disposable session, then retain only exact configured
  // Job/artifact coordinates without persisting raw URLs or Job IDs.
  const filter = { urls: ['<all_urls>'] };
  webContents.session.webRequest.onCompleted(filter, (details) => classify(details, 'completed'));
  webContents.session.webRequest.onErrorOccurred(filter, (details) => classify(details, 'error'));
  return () => ({
    completedCount: events.filter((event) => event.outcome === 'completed').length,
    errorCount: events.filter((event) => event.outcome === 'error').length,
    events: events.slice(),
  });
}

async function waitFor(webContents, expression, label, timeoutMs = WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await webContents.executeJavaScript(expression, true);
      if (value) return value;
    } catch {}
    await pause(POLL_MS);
  }
  throw new Error(`timeout:${label}`);
}

async function dismissOnboarding(webContents) {
  await waitFor(webContents, `
    (() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="首次启动引导"]');
      if (!dialog) return true;
      const button = [...dialog.querySelectorAll('button')]
        .find((item) => (item.textContent || '').trim() === '跳过引导' && !item.disabled);
      if (!button) return false;
      button.click();
      return true;
    })()
  `, 'onboarding');
}

async function navigate(window, config, target, mode = 'result') {
  const started = performance.now();
  await window.loadURL(targetUrl(config, target, mode));
  await waitFor(window.webContents,
    `Boolean(document.querySelector('[aria-label="结果主画布"]'))`,
    `${mode}_canvas`,
  );
  await dismissOnboarding(window.webContents);
  return performance.now() - started;
}

async function attachDebugger(webContents) {
  if (!webContents.debugger.isAttached()) webContents.debugger.attach('1.3');
  await webContents.debugger.sendCommand('Page.enable');
  await webContents.debugger.sendCommand('Runtime.enable');
  await webContents.debugger.sendCommand('HeapProfiler.enable');
}

/**
 * P6 OOP 深探（小票 2026-11-22）：在导航前给每个 frame 注入宿主 message tap，
 * 记录 petri:* postMessage（pack iframe 的 petri:ready 发给宿主 window）。
 * 失败不打断主流程；tap 只观测不改 sandbox/CSP/凭据。
 */
async function _installHostMessageTap(webContents) {
  if (!webContents.debugger.isAttached()) webContents.debugger.attach('1.3');
  await webContents.debugger.sendCommand('Page.enable');
  await webContents.debugger.sendCommand('Runtime.enable');
  await webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      if (window.__petriP6TapInstalled) return;
      window.__petriP6TapInstalled = true;
      window.__petriP6Messages = [];
      window.addEventListener('message', (e) => {
        const d = e.data;
        if (d && typeof d === 'object' && typeof d.type === 'string'
            && d.type.indexOf('petri:') === 0) {
          try {
            window.__petriP6Messages.push({
              type: d.type,
              surfaceId: d.surfaceId || null,
              at: Date.now(),
            });
          } catch (err) {}
        }
      });
    })();`,
  });
}

function rendererWorkingSetBytes(webContents) {
  const pid = webContents.getOSProcessId();
  const metric = app.getAppMetrics().find((entry) => entry.pid === pid);
  const kib = Number(metric?.memory?.workingSetSize);
  return Number.isFinite(kib) && kib >= 0 ? Math.round(kib * 1024) : null;
}

async function sampleMemory(webContents, stage, { collect = true } = {}) {
  const raw = await webContents.debugger.sendCommand('Runtime.getHeapUsage');
  const workingSetBytes = rendererWorkingSetBytes(webContents);
  if (collect) await webContents.debugger.sendCommand('HeapProfiler.collectGarbage');
  const postGc = await webContents.debugger.sendCommand('Runtime.getHeapUsage');
  return {
    stage,
    rawUsedBytes: Math.round(Number(raw.usedSize) || 0),
    postGcUsedBytes: Math.round(Number(postGc.usedSize) || 0),
    heapTotalBytes: Math.round(Number(postGc.totalSize) || 0),
    workingSetBytes,
  };
}

async function visualDigest(window) {
  const image = await window.webContents.capturePage();
  const png = image.toPNG();
  const size = image.getSize();
  return {
    screenshotSha256: sha256(png),
    screenshotBytes: png.length,
    width: size.width,
    height: size.height,
  };
}

async function inspectTable(webContents) {
  return waitFor(webContents, `
    (() => {
      const viewport = document.querySelector('[aria-label="科学结果表格"]');
      const viewer = viewport?.closest('[data-mode="table"]');
      const text = viewer?.innerText || '';
      const inputs = [...(viewport?.querySelectorAll('input[type="checkbox"]') || [])]
        .filter((item) => !item.disabled);
      const total = text.match(/([\\d,]+)\\s*\\/\\s*([\\d,]+)\\s*行/);
      if (!viewport || inputs.length === 0 || !total) return null;
      const totalRows = Number(total[2].replaceAll(',', ''));
      if (!Number.isFinite(totalRows)) return null;
      return {
        totalRows,
        visibleRows: inputs.length,
        firstVisibleDigest: inputs[0]?.getAttribute('aria-label') || null,
        canvasFirstVisibleMs: Number(document.querySelector('[aria-label="结果主画布"]')?.getAttribute('data-first-visible-ms')) || null,
      };
    })()
  `, 'virtual_table_ready');
}

async function measureTableScroll(webContents) {
  return webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const viewport = document.querySelector('[aria-label="科学结果表格"]');
      if (!(viewport instanceof HTMLElement)) return reject(new Error('table_viewport_missing'));
      const before = viewport.querySelector('input[type="checkbox"]')?.getAttribute('aria-label') || '';
      const started = performance.now();
      viewport.scrollTop = 10 * 32;
      viewport.dispatchEvent(new Event('scroll', { bubbles: true }));
      const deadline = started + 5000;
      const inspect = () => {
        const after = viewport.querySelector('input[type="checkbox"]')?.getAttribute('aria-label') || '';
        if (after && after !== before) return resolve({ feedbackMs: performance.now() - started, changed: true });
        if (performance.now() > deadline) return resolve({ feedbackMs: performance.now() - started, changed: false });
        requestAnimationFrame(inspect);
      };
      requestAnimationFrame(inspect);
    })
  `, true);
}

async function measureSelectionFeedback(webContents) {
  return webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const viewport = document.querySelector('[aria-label="科学结果表格"]');
      const input = viewport?.querySelector('input[type="checkbox"]:not(:disabled)');
      if (!(input instanceof HTMLInputElement)) return reject(new Error('selectable_row_missing'));
      const started = performance.now();
      input.click();
      const deadline = started + 5000;
      const inspect = () => {
        if (input.checked) return resolve({ feedbackMs: performance.now() - started, selected: true });
        if (performance.now() > deadline) return resolve({ feedbackMs: performance.now() - started, selected: false });
        requestAnimationFrame(inspect);
      };
      requestAnimationFrame(inspect);
    })
  `, true);
}

async function measureSortFeedback(webContents) {
  return webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const viewport = document.querySelector('[aria-label="科学结果表格"]');
      const viewer = viewport?.closest('[data-mode="table"]');
      const button = [...(viewer?.querySelectorAll('button') || [])]
        .find((item) => /^[A-Za-z_][A-Za-z0-9_.-]*(?: [↑↓])?$/.test((item.textContent || '').trim()));
      if (!(button instanceof HTMLButtonElement)) return reject(new Error('sortable_column_missing'));
      const before = (button.textContent || '').trim();
      const started = performance.now();
      button.click();
      const deadline = started + 5000;
      const inspect = () => {
        const after = (button.textContent || '').trim();
        if (after !== before && / [↑↓]$/.test(after)) {
          return resolve({ feedbackMs: performance.now() - started, changed: true });
        }
        if (performance.now() > deadline) {
          return resolve({ feedbackMs: performance.now() - started, changed: false });
        }
        requestAnimationFrame(inspect);
      };
      requestAnimationFrame(inspect);
    })
  `, true);
}

async function measureFilterFeedback(webContents) {
  return webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const viewer = document.querySelector('[aria-label="科学结果表格"]')?.closest('[data-mode="table"]');
      const field = document.querySelector('select[aria-label="筛选字段"]');
      const input = document.querySelector('input[aria-label="筛选内容"]');
      if (!viewer || !(field instanceof HTMLSelectElement) || !(input instanceof HTMLInputElement)) {
        return reject(new Error('filter_controls_missing'));
      }
      const option = [...field.options].find((item) => item.value === 'gene');
      if (!option) return reject(new Error('filter_field_missing'));
      field.value = option.value;
      field.dispatchEvent(new Event('change', { bubbles: true }));
      requestAnimationFrame(() => {
        const readSummary = () => [...viewer.querySelectorAll('span')]
          .map((item) => (item.textContent || '').trim())
          .find((value) => /^\\d[\\d,]* \\/ \\d[\\d,]* 行$/.test(value)) || '';
        const readFirstRow = () => viewer.querySelector('[aria-label="科学结果表格"] input[aria-label^="选择 "]')
          ?.getAttribute('aria-label') || '';
        const beforeSummary = readSummary();
        const beforeFirstRow = readFirstRow();
        if (!beforeSummary || !beforeFirstRow) {
          return reject(new Error('filter_query_baseline_missing'));
        }
        const expected = 'GENE099999';
        const started = performance.now();
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (!setter) return reject(new Error('filter_value_setter_missing'));
        setter.call(input, expected);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const deadline = started + 5000;
        let feedbackMs = null;
        const inspect = () => {
          const afterSummary = readSummary();
          const afterFirstRow = readFirstRow();
          const queryChanged = afterSummary !== beforeSummary || afterFirstRow !== beforeFirstRow;
          const loading = (viewer.textContent || '').includes('读取完整表查询…');
          if (feedbackMs === null && input.value === expected) {
            feedbackMs = performance.now() - started;
          }
          if (input.value === expected && queryChanged && !loading) {
            return resolve({
              feedbackMs,
              queryCompleteMs: performance.now() - started,
              changed: true,
              queryChanged: true,
              matchedSummaryChanged: afterSummary !== beforeSummary,
              firstVisibleRowChanged: afterFirstRow !== beforeFirstRow,
            });
          }
          if (performance.now() > deadline) {
            return resolve({
              feedbackMs: feedbackMs ?? performance.now() - started,
              queryCompleteMs: performance.now() - started,
              changed: false,
              queryChanged,
              matchedSummaryChanged: afterSummary !== beforeSummary,
              firstVisibleRowChanged: afterFirstRow !== beforeFirstRow,
            });
          }
          requestAnimationFrame(inspect);
        };
        requestAnimationFrame(inspect);
      });
    })
  `, true);
}

async function measureArtifactSwitch(webContents, target) {
  // UX1A-era compact navigator contract: artifact switching is a
  // `select[aria-label="切换当前结果"]` whose option values are artifact file
  // names. Switch success is observed through the shell's
  // `data-debug-selected-name` projection plus the product
  // `data-artifact-switch-ms` metric.
  return webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const canvas = document.querySelector('[aria-label="结果主画布"]');
      const artifactName = ${JSON.stringify(target.artifact)};
      if (!canvas) return reject(new Error('result_canvas_missing'));
      const select = canvas.querySelector('select[aria-label="切换当前结果"]');
      if (!(select instanceof HTMLSelectElement)) {
        return reject(new Error('artifact_switch_control_missing'));
      }
      const option = [...select.options].find((item) => item.value === artifactName);
      if (!option) {
        return reject(new Error('artifact_switch_option_missing:' + artifactName));
      }
      const started = performance.now();
      select.value = artifactName;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      const deadline = started + 5000;
      const inspect = () => {
        const surface = canvas.closest('[data-artifact-switch-ms]')
          || document.querySelector('[data-artifact-switch-ms]');
        const productMetricMs = Number(surface?.getAttribute('data-artifact-switch-ms'));
        const selectedName = document.querySelector('[data-debug-selected-name]')
          ?.getAttribute('data-debug-selected-name');
        const wallFeedbackMs = performance.now() - started;
        if (selectedName === artifactName && Number.isFinite(productMetricMs)
            && productMetricMs >= 0) {
          return resolve({
            feedbackMs: Math.max(productMetricMs, wallFeedbackMs),
            productMetricMs,
            wallFeedbackMs,
            changed: true,
          });
        }
        if (performance.now() > deadline) {
          return resolve({
            feedbackMs: wallFeedbackMs,
            productMetricMs: Number.isFinite(productMetricMs) ? productMetricMs : null,
            wallFeedbackMs,
            changed: false,
          });
        }
        requestAnimationFrame(inspect);
      };
      requestAnimationFrame(inspect);
    })
  `, true);
}

async function measureVirtualPageLoad(webContents) {
  return webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const viewport = document.querySelector('[aria-label="科学结果表格"]');
      if (!(viewport instanceof HTMLElement)) return reject(new Error('table_viewport_missing'));
      const before = viewport.querySelector('input[type="checkbox"]')?.getAttribute('aria-label') || '';
      const started = performance.now();
      viewport.scrollTop = 250 * 32;
      viewport.dispatchEvent(new Event('scroll', { bubbles: true }));
      const deadline = started + 30000;
      const inspect = () => {
        const after = viewport.querySelector('input[type="checkbox"]')?.getAttribute('aria-label') || '';
        const loading = [...viewport.parentElement.querySelectorAll('div')]
          .some((item) => (item.textContent || '').trim() === '读取完整表查询…');
        if (after && after !== before && !loading) {
          return resolve({ pageLoadMs: performance.now() - started, changed: true });
        }
        if (performance.now() > deadline) return resolve({ pageLoadMs: performance.now() - started, changed: false });
        requestAnimationFrame(inspect);
      };
      requestAnimationFrame(inspect);
    })
  `, true);
}

async function inspectSvgExport(webContents, target) {
  return waitFor(webContents, `
    (async () => {
      const canvas = document.querySelector('[aria-label="结果主画布"]');
      const expectedJobId = ${JSON.stringify(target.jobId)};
      const expectedArtifact = ${JSON.stringify(target.artifact)};
      if (!canvas) return null;
      const matchesTarget = (value) => {
        try {
          const source = new URL(value || '', window.location.href);
          const match = source.pathname.match(/\\/tools\\/file\\/([^/]+)\\/([^/]+)$/);
          return Boolean(match
            && decodeURIComponent(match[1]) === expectedJobId
            && decodeURIComponent(match[2]) === expectedArtifact);
        } catch {
          return false;
        }
      };
      const link = [...canvas.querySelectorAll('a')].find((item) => (
        (item.textContent || '').trim() === '导出 SVG' && matchesTarget(item.getAttribute('href'))
      ));
      if (!(link instanceof HTMLAnchorElement)) return null;
      const started = performance.now();
      const response = await fetch(link.href);
      if (!response.ok) return null;
      const text = await response.text();
      const fetchMs = performance.now() - started;
      return {
        exportLinkPresent: true,
        exportHrefMatched: true,
        bytes: text.length,
        validSvgRoot: /<svg[\\s>]/.test(text.slice(0, 4000)),
        fetchMs,
        switch: {
          changed: true,
          feedbackMs: fetchMs,
          productMetricMs: null,
          wallFeedbackMs: fetchMs,
        },
        sourceKind: 'tool_file',
        sourceTargetMatched: true,
        artifactTargetMatched: true,
      };
    })()
  `, `svg_export_ready:${target.artifact}`);
}

async function inspectPlotProjection(webContents, target) {
  return waitFor(webContents, `
    (() => {
      const canvas = document.querySelector('[aria-label="结果主画布"]');
      const expectedJobId = ${JSON.stringify(target.jobId)};
      const expectedArtifact = ${JSON.stringify(target.artifact)};
      const selectedName = document.querySelector('[data-debug-selected-name]')
        ?.getAttribute('data-debug-selected-name');
      if (selectedName !== expectedArtifact) return null;
      const matchesTarget = (value) => {
        try {
          const source = new URL(value || '', window.location.href);
          const match = source.pathname.match(/\\/tools\\/file\\/([^/]+)\\/([^/]+)$/);
          return Boolean(match
            && decodeURIComponent(match[1]) === expectedJobId
            && decodeURIComponent(match[2]) === expectedArtifact);
        } catch {
          return false;
        }
      };
      const image = [...(canvas?.querySelectorAll('img') || [])]
        .find((item) => matchesTarget(item.currentSrc || item.src)
          && item.complete && item.naturalWidth > 0 && item.naturalHeight > 0);
      if (image) {
        return {
          rendered: true,
          renderMode: 'source_image',
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          pointCount: 0,
          sourceKind: 'tool_file',
          sourceTargetMatched: true,
          artifactTargetMatched: true,
        };
      }
      const plot = canvas?.querySelector('[aria-label="可选择科学散点图"]');
      const bounds = plot?.getBoundingClientRect();
      const pointCount = plot?.querySelectorAll('circle').length || 0;
      return bounds && bounds.width > 0 && bounds.height > 0 && pointCount > 0 ? {
        rendered: true,
        renderMode: 'scientific_interaction',
        renderedWidth: Math.round(bounds.width),
        renderedHeight: Math.round(bounds.height),
        pointCount,
        sourceKind: 'scientific_interaction',
        sourceTargetMatched: true,
        artifactTargetMatched: true,
      } : null;
    })()
  `, `plot_projection_ready:${target.artifact}`);
}

async function inspectReport(webContents, target) {
  const deadline = Date.now() + WAIT_MS;
  let reportObserver = null;
  let lastObserverError = 'report_frame_not_observed';
  while (Date.now() < deadline) {
    try {
      const iframeState = await webContents.executeJavaScript(`
        (() => {
          const canvas = document.querySelector('[aria-label="结果主画布"]');
          const expectedJobId = ${JSON.stringify(target.jobId)};
          const expectedArtifact = ${JSON.stringify(target.artifact)};
          const matchesTarget = (value) => {
            try {
              const source = new URL(value || '', window.location.href);
              const match = source.pathname.match(/\\/tools\\/file\\/([^/]+)\\/([^/]+)$/);
              return Boolean(match
                && decodeURIComponent(match[1]) === expectedJobId
                && decodeURIComponent(match[2]) === expectedArtifact);
            } catch {
              return false;
            }
          };
          const frame = [...(canvas?.querySelectorAll('iframe') || [])]
            .find((item) => matchesTarget(item.src));
          const bounds = frame?.getBoundingClientRect();
          const selectedName = document.querySelector('[data-debug-selected-name]')
            ?.getAttribute('data-debug-selected-name');
          const artifactTargetMatched = selectedName === expectedArtifact;
          let sourceKind = 'missing';
          let sourceTargetMatched = false;
          try {
            const source = new URL(frame?.src || '', window.location.href);
            sourceKind = source.pathname.includes('/result-studio/revisions/')
              ? 'revision'
              : source.pathname.includes('/tools/file/')
                ? 'tool_file'
                : source.protocol === 'data:'
                  ? 'embedded'
                  : 'other';
            sourceTargetMatched = matchesTarget(source.toString());
          } catch {}
          return {
            present: Boolean(frame),
            visible: Boolean(bounds && bounds.width > 0 && bounds.height > 0),
            width: Math.round(bounds?.width || 0),
            height: Math.round(bounds?.height || 0),
            sourceKind,
            sourceTargetMatched,
            artifactTargetMatched,
          };
        })()
      `, true);
      if (!reportObserver) {
        const { frameTree } = await webContents.debugger.sendCommand('Page.getFrameTree');
        const pending = frameTree ? [frameTree] : [];
        const frameKinds = [];
        let reportFrameId = null;
        while (pending.length > 0 && !reportFrameId) {
          const current = pending.shift();
          const frameUrl = String(current?.frame?.url || '');
          let frameKind = 'other';
          try {
            const parsed = new URL(frameUrl);
            frameKind = parsed.pathname.includes('/tools/file/')
              ? 'tool_file'
              : parsed.pathname.includes('/result-studio/revisions/')
                ? 'revision'
                : parsed.protocol.replace(':', '') || 'other';
          } catch {}
          frameKinds.push(frameKind);
          if (matchesToolFileTarget(frameUrl, target)) {
            reportFrameId = current.frame.id;
            break;
          }
          pending.push(...(current?.childFrames || []));
        }
        lastObserverError = `iframe=${iframeState.present}/${iframeState.visible}`
          + `/${iframeState.sourceKind};frames=${frameKinds.join(',') || 'none'}`;
        if (reportFrameId) {
          const world = await webContents.debugger.sendCommand('Page.createIsolatedWorld', {
            frameId: reportFrameId,
            worldName: 'petri-p6-report-observer',
            grantUniveralAccess: false,
          });
          reportObserver = { contextId: world.executionContextId, sessionId: null };
        } else {
          // Cross-site report iframes are out-of-process targets and are not
          // present in the top-level Page frame tree. Attach a debugger
          // session to that isolated target without changing iframe sandbox.
          const { targetInfos = [] } = await webContents.debugger.sendCommand('Target.getTargets');
          const reportTarget = targetInfos.find((targetInfo) => (
            targetInfo.type === 'iframe'
            && matchesToolFileTarget(targetInfo.url, target)
          ));
          if (reportTarget) {
            const attached = await webContents.debugger.sendCommand('Target.attachToTarget', {
              targetId: reportTarget.targetId,
              flatten: true,
            });
            await webContents.debugger.sendCommand('Runtime.enable', {}, attached.sessionId);
            reportObserver = { contextId: null, sessionId: attached.sessionId };
            lastObserverError += ';oopif=attached';
          } else {
            lastObserverError += `;targets=${targetInfos.map((target) => target.type).join(',') || 'none'}`;
          }
        }
      }
      if (reportObserver) {
        // The product intentionally denies report scripts. A Chromium
        // isolated observer world can read rendered DOM without weakening
        // that iframe sandbox or granting report code execution.
        const evaluation = await webContents.debugger.sendCommand('Runtime.evaluate', {
          ...(reportObserver.contextId ? { contextId: reportObserver.contextId } : {}),
          returnByValue: true,
          expression: `
            (() => {
              const documentBody = document.body;
              const text = documentBody?.innerText || '';
              const embeddedImages = [...(documentBody?.querySelectorAll('img') || [])]
                .filter((image) => (image.currentSrc || image.src || '').startsWith('data:image/')
                  && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
              return text.length >= 100 && embeddedImages.length > 0 ? {
                textCharacters: text.length,
                headingCount: documentBody.querySelectorAll('h1,h2,h3').length,
                embeddedImageCount: embeddedImages.length,
                firstEmbeddedImageWidth: embeddedImages[0].naturalWidth,
                publicProjectionAudit: {
                  absolutePath: text.includes('/Users/') || text.includes('/home/')
                    || text.includes(':' + String.fromCharCode(92)),
                  providerMaterial: /(?:sk-[A-Za-z0-9]{12,}|api[_ -]?key\\s*[:=])/i.test(text),
                  rawInternalId: /\\b(?:rev|cs|job|tj|conv|sel)_[A-Za-z0-9._-]{6,}\\b/.test(text),
                },
              } : null;
            })()
          `,
        }, reportObserver.sessionId || undefined);
        if (evaluation.exceptionDetails) {
          throw new Error(`report_observer_evaluation_failed:${evaluation.exceptionDetails.text || 'unknown'}`
            + `:${evaluation.exceptionDetails.lineNumber ?? -1}:${evaluation.exceptionDetails.columnNumber ?? -1}`);
        }
        if (evaluation.result?.value && iframeState.visible
            && iframeState.sourceTargetMatched && iframeState.artifactTargetMatched) {
          return {
            iframeVisible: true,
            iframeWidth: iframeState.width,
            iframeHeight: iframeState.height,
            iframeSourceKind: iframeState.sourceKind,
            sourceTargetMatched: true,
            artifactTargetMatched: true,
            ...evaluation.result.value,
          };
        }
      }
    } catch (error) {
      lastObserverError = String(error?.message || error).slice(0, 300);
      reportObserver = null;
    }
    await pause(POLL_MS);
  }
  throw new Error(`timeout:report_ready:${lastObserverError}`);
}

async function switchResultMode(webContents, label, expectedMode) {
  await waitFor(webContents, `
    (() => {
      const nav = document.querySelector('nav[aria-label="结果视图"]');
      const button = [...(nav?.querySelectorAll('button') || [])]
        .find((item) => (item.textContent || '').trim() === ${JSON.stringify(label)});
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()
  `, `${expectedMode}_control`);
  return waitFor(webContents,
    `Boolean(document.querySelector('[aria-label="Result Studio 版本与变更"][data-mode=${JSON.stringify(expectedMode)}]'))`,
    `${expectedMode}_panel`,
  );
}

function findTableCompareSection() {
  return `
    (() => {
      const panel = document.querySelector('[aria-label="Result Studio 版本与变更"]');
      const heading = [...(panel?.querySelectorAll('h4') || [])]
        .find((item) => (item.textContent || '').includes('classified_table'));
      return heading?.parentElement || null;
    })()
  `;
}

async function openProgressiveTable(webContents) {
  const available = await waitFor(webContents, `
    (() => {
      const section = ${findTableCompareSection()};
      const button = [...(section?.querySelectorAll('button') || [])]
        .find((item) => (item.textContent || '').trim() === '渐进查看候选表' && !item.disabled);
      return button ? true : null;
    })()
  `, 'progressive_table_action');
  if (!available) throw new Error('progressive_table_action_missing');
  await webContents.executeJavaScript(`
    (() => {
      const section = ${findTableCompareSection()};
      const button = [...section.querySelectorAll('button')]
        .find((item) => (item.textContent || '').trim() === '渐进查看候选表');
      button.click();
    })()
  `, true);
  return waitFor(webContents, `
    (() => {
      const section = ${findTableCompareSection()};
      const rows = section?.querySelectorAll('tbody tr').length || 0;
      const more = [...(section?.querySelectorAll('button') || [])]
        .some((item) => (item.textContent || '').trim() === '继续加载' && !item.disabled);
      return rows >= 50 ? { rows, hasMore: more } : null;
    })()
  `, 'progressive_table_first_page');
}

async function loadMoreProgressiveTable(webContents, expectedRows) {
  const started = performance.now();
  await webContents.executeJavaScript(`
    (() => {
      const section = ${findTableCompareSection()};
      const button = [...section.querySelectorAll('button')]
        .find((item) => (item.textContent || '').trim() === '继续加载' && !item.disabled);
      if (!button) throw new Error('progressive_more_missing');
      button.click();
    })()
  `, true);
  const state = await waitFor(webContents, `
    (() => {
      const section = ${findTableCompareSection()};
      const rows = section?.querySelectorAll('tbody tr').length || 0;
      return rows >= ${Number(expectedRows)} ? { rows } : null;
    })()
  `, `progressive_table_${expectedRows}`);
  return { rows: state.rows, loadMs: performance.now() - started };
}

async function inspectHistory(webContents) {
  return waitFor(webContents, `
    (() => {
      const panel = document.querySelector('[aria-label="Result Studio 版本与变更"][data-mode="history"]');
      if (!panel) return null;
      const versions = [...panel.querySelectorAll('strong')]
        .filter((item) => /^v\\d+/.test((item.textContent || '').trim())).length;
      const loadMore = [...panel.querySelectorAll('button')]
        .some((item) => (item.textContent || '').trim() === '加载更早版本' && !item.disabled);
      return versions >= 100 && loadMore ? { versions, loadMore } : null;
    })()
  `, 'history_first_page');
}

async function loadMoreHistory(webContents, initialCount) {
  const started = performance.now();
  await webContents.executeJavaScript(`
    (() => {
      const panel = document.querySelector('[aria-label="Result Studio 版本与变更"][data-mode="history"]');
      const button = [...panel.querySelectorAll('button')]
        .find((item) => (item.textContent || '').trim() === '加载更早版本' && !item.disabled);
      if (!button) throw new Error('history_more_missing');
      button.click();
    })()
  `, true);
  const state = await waitFor(webContents, `
    (() => {
      const panel = document.querySelector('[aria-label="Result Studio 版本与变更"][data-mode="history"]');
      const versions = [...panel.querySelectorAll('strong')]
        .filter((item) => /^v\\d+/.test((item.textContent || '').trim())).length;
      return versions > ${Number(initialCount)} ? { versions } : null;
    })()
  `, 'history_second_page');
  return { versions: state.versions, loadMs: performance.now() - started };
}

async function inspectPublicProjection(webContents) {
  return webContents.executeJavaScript(`
    (() => {
      const text = document.body?.innerText || '';
      return {
        absolutePath: /(?:\\/Users\\/|\\/home\\/|[A-Za-z]:\\\\)/.test(text),
        providerMaterial: /(?:sk-[A-Za-z0-9]{12,}|api[_ -]?key\\s*[:=])/i.test(text),
        rawInternalId: /\\b(?:rev|cs|job|tj|conv|sel)_[A-Za-z0-9._-]{6,}\\b/.test(text),
      };
    })()
  `, true);
}

/**
 * P6 OOP iframe 深探（小票 2026-11-22）：
 * 对 Target.getTargets 枚举到的跨进程 iframe target，用
 * Target.attachToTarget({ targetId, flatten: true }) 挂进独立 session，读四项真值：
 *   ① document 加载态（readyState / title / #bioTable / #stateLoading）
 *   ② iframe 内执行上下文可用性（Runtime.evaluate 是否可达、contextAvailable）
 *   ③ console/message 报文（Log.enable + Runtime.exceptionThrown，区分导航前拒绝 vs 加载后脚本错）
 *   ④ window.__petriSurfaceReady / petri:ready 握手（iframe 侧标记 + 宿主 message tap）
 * 全部为只读观测，不改 sandbox token/CSP/凭据（安全边界不擅改）。
 */
async function attachOopPackFrame(webContents, targetInfos) {
  const allIframeTargets = (Array.isArray(targetInfos) ? targetInfos : [])
    .filter((targetInfo) => targetInfo && targetInfo.type === 'iframe');
  const targets = allIframeTargets
    .filter((targetInfo) => String(targetInfo.url || '').startsWith('petri-pack:'));
  const sessions = [];
  const rows = [];
  const consoleEvents = [];
  const onMessage = (_event, method, params, sessionId) => {
    if (!sessionId || !sessions.includes(sessionId)) return;
    if (method === 'Runtime.consoleAPICalled') {
      const text = (params.args || []).map((arg) => String(arg.value ?? arg.description ?? '')).join(' ');
      consoleEvents.push(`console:${params.type || 'log'}: ${text}`.slice(0, 300));
    } else if (method === 'Runtime.exceptionThrown') {
      const detail = params.exceptionDetails || {};
      consoleEvents.push(`exception: ${detail.text || detail.exception?.description || 'unknown'}`.slice(0, 300));
    } else if (method === 'Log.entryAdded') {
      const entry = params.entry || {};
      consoleEvents.push(`log:${entry.level || 'log'}: ${entry.text || ''}`.slice(0, 300));
    }
    if (consoleEvents.length > 30) consoleEvents.shift();
  };
  webContents.debugger.on('message', onMessage);
  try {
    for (const target of targets.slice(0, 4)) {
      let sessionId = null;
      let row;
      try {
        const attached = await webContents.debugger.sendCommand('Target.attachToTarget', {
          targetId: target.targetId,
          flatten: true,
        });
        sessionId = attached?.sessionId || null;
        if (!sessionId) {
          row = { url: target.url, attached: false, error: 'attach_no_session' };
        } else {
          sessions.push(sessionId);
          await webContents.debugger.sendCommand('Runtime.enable', {}, sessionId);
          await webContents.debugger.sendCommand('Log.enable', {}, sessionId);
          const evaluated = await webContents.debugger.sendCommand('Runtime.evaluate', {
            expression: `(() => {
              const stateLoading = document.querySelector('#stateLoading');
              const bioTable = document.querySelector('#bioTable');
              return {
                readyState: document.readyState,
                documentUrl: location.href,
                documentTitle: document.title,
                htmlLength: (document.documentElement?.outerHTML || '').length,
                bodyText: (document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 200),
                hasBioTable: Boolean(bioTable),
                bioTableRows: bioTable ? bioTable.querySelectorAll('tbody tr').length : 0,
                hasStateLoading: Boolean(stateLoading),
                stateLoadingHidden: stateLoading ? stateLoading.hidden : null,
                surfaceReady: window.__petriSurfaceReady === true,
                surfaceReadyRaw: typeof window.__petriSurfaceReady,
              };
            })()`,
            returnByValue: true,
          }, sessionId);
          if (evaluated?.exceptionDetails) {
            row = {
              url: target.url, attached: true, contextAvailable: false,
              error: `evaluate_exception:${(evaluated.exceptionDetails.text || '').slice(0, 160)}`,
            };
          } else {
            row = Object.assign(
              { url: target.url, attached: true, contextAvailable: true },
              evaluated?.result?.value || {},
            );
          }
        }
      } catch (error) {
        row = { url: target.url, attached: Boolean(sessionId), error: String(error?.message || error).slice(0, 200) };
      }
      row.consoleTail = consoleEvents.slice(-6);
      if (row.attached && row.contextAvailable) {
        row.loadState = row.readyState === 'complete' ? 'oop_loaded'
          : row.readyState === 'loading' ? 'oop_loading' : 'oop_other';
      } else {
        row.loadState = row.attached ? 'oop_context_unavailable' : 'oop_attach_failed';
      }
      rows.push(row);
    }
  } finally {
    webContents.debugger.removeListener('message', onMessage);
  }
  // 宿主 message tap 读数：pack iframe 的 petri:ready 是否抵达宿主 window。
  // 用 CDP Runtime.evaluate（独立协议通道）而非 executeJavaScript——后者在主上下文被
  // pack iframe 导航阻塞时会永不 resolve（实测挂起 >7min），CDP 命令不受影响。
  let hostMessages = [];
  try {
    if (!webContents.debugger.isAttached()) webContents.debugger.attach('1.3');
    const evaluated = await Promise.race([
      webContents.debugger.sendCommand('Runtime.evaluate', {
        expression: 'window.__petriP6Messages || []',
        returnByValue: true,
      }),
      new Promise((resolve) => setTimeout(() => resolve({ cdpTimeout: true }), 8_000)),
    ]);
    if (evaluated?.exceptionDetails || evaluated?.cdpTimeout) {
      hostMessages = [{ captureError: evaluated?.cdpTimeout ? 'cdp_timeout' : String(evaluated.exceptionDetails.text).slice(0, 120) }];
    } else {
      hostMessages = evaluated?.result?.value || [];
    }
  } catch (error) {
    hostMessages = [{ captureError: String(error?.message || error).slice(0, 120) }];
  }
  return evaluateOopProbe({
    frames: rows,
    iframeTargets: allIframeTargets.map((target) => ({ type: target.type, url: String(target.url || '').slice(0, 200) })),
    hostMessages: Array.isArray(hostMessages) ? hostMessages.slice(-12) : [],
    consoleTail: consoleEvents.slice(-8),
  });
}

/**
 * 纯函数：OOP 深探读数 → verdict（不触网、可独立测试）。
 * verdict 判据树：
 *   oop_no_iframe_target           —— Target.getTargets 无 iframe target（导航层拦截在 target 创建前）
 *   oop_attach_failed              —— 有 target 但 attachToTarget 失败
 *   oop_context_unavailable        —— attach 成功但 Runtime.evaluate 不可达（document 未建立）
 *   oop_document_loading           —— document readyState=loading（导航挂起/被拒表现）
 *   oop_document_replaced          —— document 存在但非 result.html（title/DOM 不匹配，被替换/拒绝）
 *   oop_document_present_ready_missing —— result.html DOM 在场但 petri:ready 未达宿主（脚本层）
 *   oop_document_present_ready_sent    —— result.html DOM 在场且 petri:ready 已发（宿主侧问题）
 */
function evaluateOopProbe(input) {
  const payload = input && typeof input === 'object' ? input : {};
  const rows = Array.isArray(payload.frames) ? payload.frames : [];
  const iframeTargets = Array.isArray(payload.iframeTargets) ? payload.iframeTargets : [];
  const hostMessages = Array.isArray(payload.hostMessages) ? payload.hostMessages : [];
  const consoleTail = Array.isArray(payload.consoleTail) ? payload.consoleTail : [];
  const readySent = hostMessages.some((message) => message && message.type === 'petri:ready');
  const contextRows = rows.filter((row) => row && row.contextAvailable === true);
  const doc = contextRows.find((row) => row.documentTitle === '生信主结果') || contextRows[0] || null;
  let verdict = 'oop_no_iframe_target';
  if (iframeTargets.length > 0) {
    const packTargets = iframeTargets.filter((target) => String(target.url || '').startsWith('petri-pack:'));
    if (packTargets.length === 0) {
      // iframe target 存在但 URL 非 petri-pack：导航在 URL 提交前被拦（DOM 元素在场、frame 未建立）。
      verdict = 'oop_pack_target_absent';
    } else if (rows.length === 0 || rows.every((row) => row.attached === false)) {
      verdict = 'oop_attach_failed';
    } else if (contextRows.length === 0) {
      verdict = 'oop_context_unavailable';
    } else if (doc.readyState === 'loading' || doc.readyState === 'uninitialized') {
      verdict = 'oop_document_loading';
    } else if (doc.documentTitle !== '生信主结果' && !doc.hasBioTable) {
      verdict = 'oop_document_replaced';
    } else if (readySent) {
      verdict = 'oop_document_present_ready_sent';
    } else {
      verdict = 'oop_document_present_ready_missing';
    }
  }
  return {
    verdict,
    iframeTargetCount: iframeTargets.length,
    attachedCount: rows.filter((row) => row.attached === true).length,
    contextReadableCount: contextRows.length,
    readySignal: readySent || contextRows.some((row) => row.surfaceReady === true),
    frames: rows,
    iframeTargets,
    hostMessages,
    consoleTail,
  };
}

/**
 * P6-TABLE-LOAD 前置票（R2 清偿批 2026-11-21）：pack iframe 探针入口。
 * 枚举 petri-pack:// frame（frameTree + 跨进程 target），isolated world 读 iframe 内
 * ready/console 标记，经 evaluatePackSurfaceProbe 归因；probe 异常不打断失败诊断主流程。
 * （与 inspectReport 同构：frameTree 主 frame 树 + Target.getTargets 捕 OOP iframe。）
 */
async function inspectPackSurface(webContents) {
  if (!webContents.debugger.isAttached()) webContents.debugger.attach('1.3');
  await webContents.debugger.sendCommand('Page.enable');
  await webContents.debugger.sendCommand('Runtime.enable');
  const { frameTree } = await webContents.debugger.sendCommand('Page.getFrameTree');
  const pending = frameTree ? [frameTree] : [];
  const frameRows = [];
  const { targetInfos = [] } = await webContents.debugger.sendCommand('Target.getTargets');
  while (pending.length > 0) {
    const current = pending.shift();
    const frameUrl = String(current?.frame?.url || '');
    let frameProbe = { url: frameUrl, readySignal: false, consoleTail: [], loadState: 'unknown' };
    if (frameUrl.startsWith('petri-pack:')) {
      try {
        const world = await webContents.debugger.sendCommand('Page.createIsolatedWorld', {
          frameId: current.frame.id,
          worldName: 'petri-p6-pack-observer',
          grantUniveralAccess: false,
        });
        const inner = await webContents.debugger.sendCommand('Runtime.evaluate', {
          expression: '(() => ({ readySignal: window.__petriSurfaceReady === true, consoleTail: (window.__petriConsoleTail || []).slice(-6) }))()',
          contextId: world.executionContextId,
          returnByValue: true,
        });
        const value = inner?.result?.value;
        frameProbe = value
          ? Object.assign({ url: frameUrl }, value, { loadState: 'loaded' })
          : { url: frameUrl, readySignal: false, consoleTail: [], loadState: 'loaded_no_value' };
      } catch (e) {
        frameProbe = { url: frameUrl, readySignal: false, consoleTail: ['probe_error: ' + String(e.message).slice(0, 120)], loadState: 'probe_failed' };
      }
    }
    frameRows.push(frameProbe);
    pending.push(...(current?.childFrames || []));
  }
  // 所有 iframe 类型 target 都记录（含导航被拒后 URL 变为 about:blank 的），
  // 避免只在 petri-pack URL 在场时才落证——「无 target」本身就是关键判据。
  const allIframeTargets = targetInfos.filter((ti) => ti && ti.type === 'iframe');
  const probe = evaluatePackSurfaceProbe(frameRows);
  let oopProbe;
  try {
    oopProbe = await attachOopPackFrame(webContents, targetInfos);
  } catch (oopError) {
    oopProbe = {
      verdict: 'oop_probe_error',
      iframeTargets: allIframeTargets.map((ti) => ({ type: ti.type, url: String(ti.url || '').slice(0, 200) })),
      error: String(oopError?.message || oopError).slice(0, 200),
    };
  }
  // 落证：OOP 深探读数并入 packSurfaceProbe.oop（driver-result.json 失败段）。
  // 无 iframe target 时 evaluateOopProbe 判 oop_no_iframe_target（导航层拦截在 target 创建前）。
  probe.oop = oopProbe;
  return probe;
}

/**
 * 纯评估：iframe 枚举行 → 归因 verdict（no_pack_frame / pack_frame_not_loaded /
 * loaded_but_ready_not_sent / ready_sent_host_side_issue）。
 */
function evaluatePackSurfaceProbe(frames) {
  const rows = Array.isArray(frames) ? frames : [];
  const packFrames = rows.filter((r) => String(r.url || '').startsWith('petri-pack:'));
  const readySignal = rows.some((r) => r.readySignal === true);
  const consoleTail = rows.flatMap((r) => r.consoleTail || []).slice(-6);
  let verdict = 'no_pack_frame';
  if (packFrames.length > 0) {
    const loaded = packFrames.some((r) => r.loadState === 'loaded' || r.loadState === 'complete');
    if (!loaded) verdict = 'pack_frame_not_loaded';
    else if (!readySignal) verdict = 'loaded_but_ready_not_sent';
    else verdict = 'ready_sent_host_side_issue';
  }
  return {
    frames: rows,
    packUrl: packFrames.map((r) => r.url).slice(0, 4),
    frameUrl: packFrames[0]?.url ?? null,
    readySignal,
    consoleTail,
    verdict,
  };
}

async function failureDiagnostic(webContents) {
  try {
    return await webContents.executeJavaScript(`
      (() => {
        const canvas = document.querySelector('[aria-label="结果主画布"]');
        const tableViewport = document.querySelector('[aria-label="科学结果表格"]');
        // P6-TABLE-LOAD 轮2：DOM 级 iframe 元素读数（pack iframe 是否真的挂进 DOM）
        const packIframes = [...document.querySelectorAll('iframe')].map((el) => ({
          title: el.getAttribute('title') || '',
          src: (el.getAttribute('src') || '').slice(0, 100),
          visible: Boolean(el.offsetParent || el.getClientRects().length),
          width: Math.round(el.getBoundingClientRect().width),
        }));
        const visibleText = (document.body?.innerText || '').replace(/\\s+/g, ' ').trim();
        const images = [...(canvas?.querySelectorAll('img') || [])].slice(0, 10).map((image) => {
          let sourceKind = 'unknown';
          try {
            const source = new URL(image.currentSrc || image.src || '', window.location.href);
            sourceKind = source.pathname.includes('/result-studio/revisions/')
              ? 'revision'
              : source.pathname.includes('/tools/file/')
                ? 'tool_file'
                : source.protocol === 'data:'
                  ? 'embedded'
                  : 'other';
          } catch {}
          return {
            sourceKind,
            complete: image.complete,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
          };
        });
        const resourceTimings = performance.getEntriesByType('resource')
          .filter((entry) => {
            try {
              return new URL(entry.name).pathname.includes('/tools/file/');
            } catch {
              return false;
            }
          })
          .slice(-20)
          .map((entry) => {
            let artifactName = 'unknown';
            try {
              artifactName = decodeURIComponent(new URL(entry.name).pathname.split('/').at(-1) || 'unknown');
            } catch {}
            return {
              artifactName,
              initiatorType: entry.initiatorType || 'unknown',
              durationMs: Math.round(entry.duration * 100) / 100,
              responseStatus: Number.isFinite(entry.responseStatus) ? entry.responseStatus : null,
              transferSize: Number.isFinite(entry.transferSize) ? entry.transferSize : null,
              encodedBodySize: Number.isFinite(entry.encodedBodySize) ? entry.encodedBodySize : null,
              decodedBodySize: Number.isFinite(entry.decodedBodySize) ? entry.decodedBodySize : null,
            };
          });
        return {
          canvasPresent: Boolean(canvas),
          tableViewportPresent: Boolean(tableViewport),
          packIframes,
          images,
          resourceTimings,
          viewerModes: [...(canvas?.querySelectorAll('[data-mode]') || [])]
            .map((item) => item.getAttribute('data-mode')).filter(Boolean).slice(0, 20),
          canvasText: (canvas?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 2_000),
          bodyText: visibleText.slice(0, 4_000),
        };
      })()
    `, true);
  } catch (error) {
    return { inspectionError: String(error?.message || error).slice(0, 500) };
  }
}

async function run() {
  // app ready 后注册 protocol.handle（ready 前不可用）；与 privileges 同为产品单源。
  setupPackProtocol();
  const config = readConfig();
  const backendStatusObservation = registerBackendStatusHandler(config);
  const compatibilityObservation = registerIsolatedCompatibilityHandlers();
  let stage = 'window_create';
  const gone = [];
  const rendererConsole = [];
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: config.show === true,
    title: 'Petri P6 isolated pressure observation',
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: PRELOAD_PATH,
    },
  });
  const artifactNetworkObservation = registerArtifactNetworkObservation(window.webContents, config);
  // P6 OOP 深探小票（2026-11-22）：宿主 message tap 的 Page.addScriptToEvaluateOnNewDocument
  // await 在 pack iframe 导航被拦时会挂起，导致其后的 watchdog 永远设不上（实测）。
  // 深探改为纯 CDP 读 iframe document 加载态/执行上下文/console，petri:ready 以
  // iframe 侧 postMessage 已执行（document 在场即脚本跑完）为判据，不依赖宿主 tap。
  // _installHostMessageTap 保留为可选工具函数，默认不调用。
  window.webContents.on('render-process-gone', (_event, details) => {
    gone.push({ reason: details?.reason || 'unknown', exitCode: details?.exitCode ?? null });
  });
  window.webContents.on('console-message', (_event, level, message) => {
    if (Number(level) < 2) return;
    rendererConsole.push(String(message || '').slice(0, 1_000));
    if (rendererConsole.length > 20) rendererConsole.shift();
  });

  // P6 OOP 深探小票（2026-11-22）看门狗：pack iframe 导航被拦时，宿主某个
  // executeJavaScript 可能永不 resolve（实测挂起 >7min），主流程既不成功也不进 catch。
  // 超时后强制跑一次纯 CDP OOP 深探并落证，保证 table_load 断点读数不丢。
  let oopSettled = false;
  const watchdogMs = Math.max(WAIT_MS, 90_000);
  const watchdog = setTimeout(async () => {
    if (oopSettled) return;
    oopSettled = true;
    let oopProbe = { verdict: 'oop_watchdog_probe_error' };
    try {
      oopProbe = await Promise.race([
        inspectPackSurface(window.webContents),
        new Promise((resolve) => setTimeout(() => resolve({ verdict: 'oop_probe_timeout', note: 'CDP probe exceeded 25s during watchdog' }), 25_000)),
      ]);
    } catch (error) {
      oopProbe = { verdict: 'oop_probe_error', error: String(error?.message || error).slice(0, 200) };
    }
    // B1 验证（2026-11-22）：watchdog 落证带 DOM 诊断，判断 sandbox 放行后 iframe 的真实加载态。
    let diagnosticPage = { watchdog: true };
    try {
      diagnosticPage = await Promise.race([
        failureDiagnostic(window.webContents),
        new Promise((resolve) => setTimeout(() => resolve({ watchdog: true, diagnosticTimeout: true }), 8_000)),
      ]);
    } catch (diagnosticError) {
      diagnosticPage = { watchdog: true, diagnosticError: String(diagnosticError?.message || diagnosticError).slice(0, 200) };
    }
    try {
      writeFileSync(config.resultPath, `${JSON.stringify({
        schemaVersion: 1,
        passed: false,
        failedStage: stage,
        timeoutReason: 'oop_watchdog_forced',
        page: diagnosticPage,
        packSurfaceProbe: oopProbe,
        artifactNetwork: artifactNetworkObservation(),
        rendererConsole,
      }, null, 2)}\n`, { mode: 0o600 });
    } catch (writeError) {
      console.error('[p6-oop] watchdog write failed: ' + String(writeError?.message || writeError).slice(0, 200));
    }
    app.exit(3);
  }, watchdogMs);

  try {
    const memorySamples = [];
    const publicProjectionSamples = [];

    stage = 'table_load';
    const tableNavigationMs = await navigate(window, config, config.targets.table, 'result');
    const table = await inspectTable(window.webContents);
    await attachDebugger(window.webContents);
    const tableCapture = await visualDigest(window);
    memorySamples.push(await sampleMemory(window.webContents, 'table_baseline'));

    stage = 'table_scroll';
    const scroll = await measureTableScroll(window.webContents);
    const selection = await measureSelectionFeedback(window.webContents);
    const virtualPage = await measureVirtualPageLoad(window.webContents);
    const sort = await measureSortFeedback(window.webContents);
    const filter = await measureFilterFeedback(window.webContents);
    memorySamples.push(await sampleMemory(window.webContents, 'table_interactions'));
    publicProjectionSamples.push(await inspectPublicProjection(window.webContents));

    stage = 'png_load';
    const pngStarted = performance.now();
    const pngSwitch = await measureArtifactSwitch(
      window.webContents,
      config.targets.png,
      { useSection: true },
    );
    if (!pngSwitch.changed) throw new Error('png_artifact_switch_failed');
    const png = await inspectPlotProjection(window.webContents, config.targets.png);
    const pngLoadMs = performance.now() - pngStarted;
    const pngCapture = await visualDigest(window);
    memorySamples.push(await sampleMemory(window.webContents, 'png'));
    publicProjectionSamples.push(await inspectPublicProjection(window.webContents));

    stage = 'svg_load';
    const svgStarted = performance.now();
    // UX1A-era product contract: SVG/PDF are export variants of the plot
    // option (`导出 SVG` anchor), not switchable preview surfaces. The honest
    // renderer observation is: the export link targets the real
    // `/tools/file/<jobId>/volcano.svg` artifact and the renderer can fetch
    // and parse its bytes.
    const svg = await inspectSvgExport(window.webContents, config.targets.svg);
    const svgLoadMs = performance.now() - svgStarted;
    const svgCapture = await visualDigest(window);
    memorySamples.push(await sampleMemory(window.webContents, 'svg'));
    publicProjectionSamples.push(await inspectPublicProjection(window.webContents));

    stage = 'report_load';
    const reportStarted = performance.now();
    await navigate(window, config, config.targets.report, 'result');
    const report = await inspectReport(window.webContents, config.targets.report);
    const reportLoadMs = performance.now() - reportStarted;
    const reportCapture = await visualDigest(window);
    memorySamples.push(await sampleMemory(window.webContents, 'report'));
    publicProjectionSamples.push(await inspectPublicProjection(window.webContents));
    publicProjectionSamples.push(report.publicProjectionAudit);

    stage = 'compare_load';
    await navigate(window, config, config.targets.table, 'result');
    const compareStarted = performance.now();
    await switchResultMode(window.webContents, '审查', 'compare');
    const firstProgressivePage = await openProgressiveTable(window.webContents);
    const compareOpenMs = performance.now() - compareStarted;
    const progressivePages = [{ rows: firstProgressivePage.rows, loadMs: null }];
    for (const expectedRows of [100, 150, 200]) {
      progressivePages.push(await loadMoreProgressiveTable(window.webContents, expectedRows));
    }
    const compareCapture = await visualDigest(window);
    memorySamples.push(await sampleMemory(window.webContents, 'compare'));
    publicProjectionSamples.push(await inspectPublicProjection(window.webContents));

    stage = 'history_load';
    const historyStarted = performance.now();
    // compare mode renders the ResultStudioContextBar switcher, whose labels
    // are still 审查修改/版本历史; only the result-mode compact navigator uses
    // the short 审查/历史 labels.
    await switchResultMode(window.webContents, '版本历史', 'history');
    const historyFirst = await inspectHistory(window.webContents);
    const historyFirstPageMs = performance.now() - historyStarted;
    const historySecond = await loadMoreHistory(window.webContents, historyFirst.versions);
    const historyCapture = await visualDigest(window);
    memorySamples.push(await sampleMemory(window.webContents, 'history'));
    publicProjectionSamples.push(await inspectPublicProjection(window.webContents));

    const publicProjectionAudit = Object.fromEntries(
      ['absolutePath', 'providerMaterial', 'rawInternalId']
        .map((key) => [key, publicProjectionSamples.some((sample) => sample?.[key] === true)]),
    );
    const baseline = memorySamples[0];
    const peakRaw = Math.max(...memorySamples.map((item) => item.rawUsedBytes));
    const peakPostGc = Math.max(...memorySamples.map((item) => item.postGcUsedBytes));
    const workingSets = memorySamples.map((item) => item.workingSetBytes).filter(Number.isFinite);
    const memory = {
      baselinePostGcBytes: baseline.postGcUsedBytes,
      peakRawUsedBytes: peakRaw,
      peakRawGrowthBytes: Math.max(0, peakRaw - baseline.postGcUsedBytes),
      peakPostGcUsedBytes: peakPostGc,
      peakPostGcGrowthBytes: Math.max(0, peakPostGc - baseline.postGcUsedBytes),
      peakWorkingSetBytes: workingSets.length > 0 ? Math.max(...workingSets) : null,
      samples: memorySamples,
    };

    const result = {
      schemaVersion: 1,
      renderer: `Electron ${process.versions.electron}; Chromium ${process.versions.chrome}`,
      table: {
        totalRows: table.totalRows,
        visibleRows: table.visibleRows,
        navigationMs: tableNavigationMs,
        // Cold result routes do not create the in-app transition mark. The
        // driver wall clock starts before loadURL and stops only after the
        // real result canvas exists, so it is the conservative first-canvas
        // measurement for this Electron launch path.
        canvasFirstVisibleMs: tableNavigationMs,
        productCanvasFirstVisibleMs: table.canvasFirstVisibleMs,
        scrollFeedbackMs: scroll.feedbackMs,
        scrollChanged: scroll.changed,
        selectionFeedbackMs: selection.feedbackMs,
        selectionChanged: selection.selected,
        sortFeedbackMs: sort.feedbackMs,
        sortChanged: sort.changed,
        filterFeedbackMs: filter.feedbackMs,
        filterQueryCompleteMs: filter.queryCompleteMs,
        filterChanged: filter.changed,
        filterQueryChanged: filter.queryChanged,
        filterMatchedSummaryChanged: filter.matchedSummaryChanged,
        filterFirstVisibleRowChanged: filter.firstVisibleRowChanged,
        virtualPageLoadMs: virtualPage.pageLoadMs,
        virtualPageChanged: virtualPage.changed,
        ...tableCapture,
      },
      media: {
        png: { loadMs: pngLoadMs, switch: pngSwitch, ...png, ...pngCapture },
        svg: { loadMs: svgLoadMs, ...svg, ...svgCapture },
        report: { loadMs: reportLoadMs, ...report, ...reportCapture },
      },
      compare: {
        openMs: compareOpenMs,
        progressiveRows: progressivePages.at(-1).rows,
        progressivePages,
        ...compareCapture,
      },
      history: {
        firstPageVersions: historyFirst.versions,
        firstPageMs: historyFirstPageMs,
        afterPaginationVersions: historySecond.versions,
        paginationMs: historySecond.loadMs,
        ...historyCapture,
      },
      memory,
      publicProjectionAudit,
      publicProjectionSampleCount: publicProjectionSamples.length,
      renderProcessGoneCount: gone.length,
      artifactNetwork: artifactNetworkObservation(),
      backendStatus: backendStatusObservation(),
      isolatedCompatibility: compatibilityObservation(),
    };
    result.passed = result.table.totalRows === 100_000
      && result.table.scrollChanged
      && result.table.selectionChanged
      && result.table.sortChanged
      && result.table.filterChanged
      && result.table.filterQueryChanged
      && (result.table.filterMatchedSummaryChanged || result.table.filterFirstVisibleRowChanged)
      && result.table.virtualPageChanged
      && result.media.png.switch.changed
      && result.media.svg.switch.changed
      && result.media.png.rendered === true
      && result.media.png.sourceTargetMatched === true
      && result.media.png.artifactTargetMatched === true
      && result.media.svg.exportLinkPresent === true
      && result.media.svg.validSvgRoot === true
      && result.media.svg.sourceTargetMatched === true
      && result.media.svg.artifactTargetMatched === true
      && result.media.report.iframeVisible === true
      && result.media.report.sourceTargetMatched === true
      && result.media.report.artifactTargetMatched === true
      && result.media.report.textCharacters >= 100
      && result.media.report.embeddedImageCount >= 1
      && result.compare.progressiveRows >= 200
      && result.history.firstPageVersions >= 100
      && result.history.afterPaginationVersions > result.history.firstPageVersions
      && result.publicProjectionSampleCount >= 7
      && result.publicProjectionAudit.absolutePath === false
      && result.publicProjectionAudit.providerMaterial === false
      && result.publicProjectionAudit.rawInternalId === false
      && result.renderProcessGoneCount === 0
      && result.artifactNetwork.errorCount === 0
      && result.artifactNetwork.events.some((event) => (
        event.artifactName === config.targets.svg.artifact
        && event.outcome === 'completed'
        && event.statusCode === 200
      ))
      && result.backendStatus.everyCheckReady === true;
    oopSettled = true;
    clearTimeout(watchdog);
    writeFileSync(config.resultPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    window.destroy();
  } catch (error) {
    oopSettled = true;
    clearTimeout(watchdog);
    // P6-TABLE-LOAD 前置票：table_load 阶段失败接入 pack iframe 探针
    //（petri-pack:// frame 枚举 + iframe 内 ready/console → evaluatePackSurfaceProbe 归因）。
    // OOP 探针先跑（纯 CDP），failureDiagnostic 的 executeJavaScript 在 pack iframe
    // 导航被拦时可能永不 resolve，故放在探针之后且不阻塞落证。
    let packSurfaceProbe = null;
    if (stage === 'table_load') {
      try {
        packSurfaceProbe = await inspectPackSurface(window.webContents);
      } catch (probeError) {
        packSurfaceProbe = { verdict: 'probe_error', probeError: String(probeError.message).slice(0, 200) };
      }
    }
    let page = { diagnosticSkipped: 'pack_iframe_navigation_blocked' };
    try {
      page = await Promise.race([
        failureDiagnostic(window.webContents),
        new Promise((resolve) => setTimeout(() => resolve({ diagnosticTimeout: true }), 10_000)),
      ]);
    } catch (diagnosticError) {
      page = { diagnosticError: String(diagnosticError?.message || diagnosticError).slice(0, 200) };
    }
    writeFileSync(config.resultPath, `${JSON.stringify({
      schemaVersion: 1,
      passed: false,
      failedStage: stage,
      page,
      packSurfaceProbe,
      artifactNetwork: artifactNetworkObservation(),
      rendererConsole,
    }, null, 2)}\n`, { mode: 0o600 });
    throw error;
  }
}

app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error?.stack || error);
    app.exit(1);
  });
