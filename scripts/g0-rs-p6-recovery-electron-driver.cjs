#!/usr/bin/env node
'use strict';

/**
 * Electron-side observer for the bounded P6 recovery prototype.
 *
 * The disposable config owns runtime coordinates. Persisted output contains
 * only semantic checks and content digests, never project IDs, URLs or paths.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const { createHash } = require('node:crypto');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { probeUrl } = require('../src/backend-health.js');

const CONFIG_ENV = 'BIOF3_P6_RECOVERY_ELECTRON_CONFIG';
const ATTEMPT_ENV = 'BIOF3_P6_RECOVERY_ELECTRON_ATTEMPT';
const PRELOAD_PATH = path.resolve(__dirname, '..', 'src', 'preload.js');
const WAIT_MS = 120_000;
const POLL_MS = 100;
const BACKEND_STATUS_TIMEOUT_MS = 1_500;

const configPath = process.env[CONFIG_ENV];
if (!configPath || !path.isAbsolute(configPath)) {
  throw new Error(`${CONFIG_ENV} must be an absolute disposable path`);
}
const launchAttempt = String(process.env[ATTEMPT_ENV] || '');
if (!/^[12]$/.test(launchAttempt)) {
  throw new Error(`${ATTEMPT_ENV} must identify one bounded launch attempt`);
}
const userDataPath = path.join(
  path.dirname(configPath),
  `electron-user-data-attempt-${launchAttempt}`,
);
mkdirSync(userDataPath, { recursive: true, mode: 0o700 });
app.setPath('userData', userDataPath);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertLoopbackUrl(value, label) {
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1'
      || !parsed.port || parsed.pathname !== '/') {
    throw new Error(`${label} must be an isolated loopback origin`);
  }
  return parsed;
}

function readConfig() {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  for (const key of [
    'uiBaseUrl', 'backendBaseUrl', 'projectId', 'conversationId',
    'jobId', 'artifact', 'resultPath', 'outputDir',
  ]) {
    if (typeof config[key] !== 'string' || !config[key]) {
      throw new Error(`driver config missing ${key}`);
    }
  }
  if (!['active-crash', 'recover', 'reopen'].includes(config.phase)) {
    throw new Error('driver phase is invalid');
  }
  const ui = assertLoopbackUrl(config.uiBaseUrl, 'uiBaseUrl');
  const backend = assertLoopbackUrl(config.backendBaseUrl, 'backendBaseUrl');
  if (ui.port === backend.port) throw new Error('UI and backend origins must differ');
  if (String(process.env.R_SERVER_PORT || '') !== backend.port) {
    throw new Error('backendBaseUrl must match the Electron preload backend port');
  }
  if (!path.isAbsolute(config.resultPath) || !path.isAbsolute(config.outputDir)) {
    throw new Error('driver output coordinates must be absolute disposable paths');
  }
  return config;
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
      pyServerUp: false,
      plumberUp: false,
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
    return { ok: false, error: 'terminal_not_exercised_by_recovery_trace' };
  });
  ipcMain.handle('terminal:session-stop', async () => {
    observations.terminalStopCount += 1;
    return { ok: true, wasRunning: false };
  });
  return () => ({ ...observations });
}

function targetUrl(config) {
  return `${config.uiBaseUrl}/project/${encodeURIComponent(config.projectId)}`
    + `?mode=history&job=${encodeURIComponent(config.jobId)}`
    + `&artifact=${encodeURIComponent(config.artifact)}`;
}

async function waitFor(webContents, expression, label, timeoutMs = WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await webContents.executeJavaScript(expression, true);
      if (last) return last;
    } catch (error) {
      last = error?.message || String(error);
    }
    await pause(POLL_MS);
  }
  throw new Error(`timeout:${label}:${JSON.stringify(last)}`);
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

function lifecycleExpression(expectedState = null) {
  const state = expectedState ? JSON.stringify(expectedState) : 'null';
  return `
    (() => {
      const panel = document.querySelector('[aria-label="Result Studio 版本与变更"]');
      if (!panel) return null;
      const lifecycle = [...panel.children]
        .find((element) => element instanceof HTMLElement && element.hasAttribute('data-state'));
      if (!lifecycle) return null;
      const lifecycleState = lifecycle.getAttribute('data-state') || '';
      if (${state} && lifecycleState !== ${state}) return null;
      const text = lifecycle.innerText || '';
      const publicText = document.body?.innerText || '';
      const expectedPreserved = ${Number(0)};
      const recoverButton = [...lifecycle.querySelectorAll('button')]
        .find((item) => (item.textContent || '').trim() === '恢复修改现场');
      return {
        lifecycleState,
        detectedInterruptedSite: text.includes('检测到中断的修改现场'),
        stoppingStageExplained: text.includes('停止于保存候选脚本'),
        preservedCandidateCountExplained:
          text.includes('已保留 ' + expectedPreserved + ' 个候选结果'),
        automaticHandlingExplained: text.includes(
          '系统将核对完整性：完整候选恢复为待确认预览；不完整现场收口为失败且不覆盖当前版本。'
        ),
        nextActionExplained: text.includes('下一步：恢复后检查候选，或重新发起修改。'),
        readyStateExplained: text.includes('版本存储正常'),
        activeOperationExplained: text.includes('结果修改正在运行'),
        activeStageExplained: text.includes(
          '当前停留在保存候选脚本；任务结束前不会执行重启恢复。'
        ),
        recoveryControlPresent: Boolean(recoverButton),
        recoveryControlEnabled: Boolean(recoverButton && !recoverButton.disabled),
        text,
        publicProjectionAudit: {
          absolutePath: /(?:\\/Users\\/|\\/home\\/|[A-Za-z]:\\\\)/.test(publicText),
          providerMaterial: /(?:sk-[A-Za-z0-9]{12,}|api[_ -]?key\\s*[:=])/i.test(publicText),
          rawInternalId: /\\b(?:p|job|tj|rev|cs|conv|sel|wfg)_[A-Za-z0-9._-]{6,}\\b/.test(publicText),
        },
      };
    })()
  `;
}

function rendererStateExpression() {
  return `
    (() => {
      const text = document.body?.innerText || '';
      const projection = document.querySelector('[data-projection]');
      const location = window.location;
      const projections = Array.from(document.querySelectorAll('[data-projection]')).map((node) => ({
        mode: node.getAttribute('data-projection'),
        hidden: node.getAttribute('aria-hidden') === 'true',
      }));
      const resultCanvas = document.querySelector('[aria-label="结果主画布"]');
      const changeSetPanel = document.querySelector('[aria-label="Result Studio 版本与变更"]');
      return {
        location: location.pathname + location.search,
        legacyMode: new URLSearchParams(location.search).get('mode'),
        requestedJob: new URLSearchParams(location.search).get('job'),
        projectionMode: projection?.getAttribute('data-projection') || null,
        projections,
        resultCanvasPresent: Boolean(resultCanvas),
        resultCanvasMode: resultCanvas?.getAttribute('data-mode') || null,
        canvasChildCount: resultCanvas
          ? (resultCanvas.querySelector('.canvasBody, [class*="canvasBody"]')?.children.length ?? -1)
          : -1,
        canvasTextSample: resultCanvas
          ? (resultCanvas.innerText || '').slice(0, 400)
          : null,
        debugArtifactShellPresent: Boolean(document.querySelector('[data-debug-artifact-count]')),
        debugArtifactCount: document.querySelector('[data-debug-artifact-count]')?.getAttribute('data-debug-artifact-count') ?? null,
        debugJobStatus: document.querySelector('[data-debug-job-status]')?.getAttribute('data-debug-job-status') ?? null,
        debugSelectedName: document.querySelector('[data-debug-selected-name]')?.getAttribute('data-debug-selected-name') ?? null,
        debugRevision: document.querySelector('[data-debug-revision]')?.getAttribute('data-debug-revision') ?? null,
        resultView: (() => {
          const node = document.querySelector('[data-debug-viewer]');
          if (!node) return null;
          return {
            selectedName: node.getAttribute('data-debug-selected-name'),
            artifactCount: node.getAttribute('data-debug-artifact-count'),
            jobStatus: node.getAttribute('data-debug-job-status'),
            viewer: node.getAttribute('data-debug-viewer'),
            revision: node.getAttribute('data-debug-revision'),
          };
        })(),
        resultStudioPanelPresent: Boolean(
          document.querySelector('[aria-label="Result Studio 版本与变更"]')
        ),
        changeSetPanelMode: changeSetPanel?.getAttribute('data-mode') || null,
        changeSetHeaderText: Boolean(changeSetPanel?.textContent?.includes('结果版本')),
        onboardingPresent: Boolean(document.querySelector('[role="dialog"][aria-label="首次启动引导"]')),
        resultsLibraryPresent: text.includes('结果库'),
        resultLoading: text.includes('加载结果中…'),
        resultMissing: text.includes('未生成可视化结果文件'),
        resultLoadFailed: text.includes('结果加载失败'),
        jobMissing: text.includes('找不到这个结果'),
        conversationBindingMissing: text.includes('没有可信的会话归属'),
        truthProjected: ['可信结果', '需要复核', '结果已阻断', '尚未核验'].some((item) => text.includes(item)),
        projectErrorBoundaryPresent: Boolean(document.querySelector('[data-projection="error"]')),
      };
    })()
  `;
}

async function readLifecycle(webContents, expectedState) {
  const raw = await waitFor(
    webContents,
    lifecycleExpression(expectedState),
    `lifecycle_${expectedState}`,
  );
  const { text, ...projected } = raw;
  return {
    ...projected,
    semanticDigest: sha256(text),
  };
}

async function captureVisual(window, config, label) {
  const png = (await window.webContents.capturePage()).toPNG();
  const filename = `${config.phase}-${label}.png`;
  writeFileSync(path.join(config.outputDir, filename), png);
  return {
    label,
    sha256: sha256(png),
    bytes: png.length,
    nonblank: png.length > 10_000,
  };
}

async function clickRecovery(webContents) {
  return webContents.executeJavaScript(`
    (() => {
      const panel = document.querySelector('[aria-label="Result Studio 版本与变更"]');
      const lifecycle = panel && [...panel.children]
        .find((element) => element instanceof HTMLElement
          && element.getAttribute('data-state') === 'recovery_available');
      const button = lifecycle && [...lifecycle.querySelectorAll('button')]
        .find((item) => (item.textContent || '').trim() === '恢复修改现场' && !item.disabled);
      if (!button) return false;
      button.click();
      return true;
    })()
  `, true);
}

async function run() {
  const config = readConfig();
  const backendStatusObservation = registerBackendStatusHandler(config);
  const compatibilityObservation = registerIsolatedCompatibilityHandlers();
  let stage = 'window_create';
  const rendererGone = [];
  const recoveryRequests = [];
  const interactionRequests = [];
  const blockedNavigations = [];
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    show: config.show === true,
    title: 'BioF3 P6 isolated recovery observation',
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: PRELOAD_PATH,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    try {
      if (new URL(url).origin !== new URL(config.uiBaseUrl).origin) {
        event.preventDefault();
        blockedNavigations.push(true);
      }
    } catch {
      event.preventDefault();
      blockedNavigations.push(true);
    }
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    rendererGone.push(details?.reason || 'unknown');
  });
  window.webContents.session.webRequest.onCompleted((details) => {
    try {
      const pathname = new URL(details.url).pathname;
      if (pathname.endsWith('/result-studio/interaction')
        || pathname.endsWith('/result-studio/selection/current')) {
        interactionRequests.push({
          kind: pathname.endsWith('/interaction') ? 'interaction' : 'selection',
          method: details.method,
          status: details.statusCode,
        });
      }
      if (details.method === 'POST'
          && pathname === '/api/result-studio/workspace/recover') {
        recoveryRequests.push(details.statusCode);
      }
    } catch {}
  });

  try {
    stage = 'load_project';
    await window.loadURL(targetUrl(config));
    await waitFor(window.webContents,
      `Boolean(document.querySelector('[aria-label="Result Studio 版本与变更"]'))`,
      'result_studio_panel');
    await dismissOnboarding(window.webContents);

    let before = null;
    let after = null;
    if (config.phase === 'active-crash') {
      stage = 'inspect_active_operation_before_crash';
      before = await readLifecycle(window.webContents, 'ready');
      before.visual = await captureVisual(window, config, 'active-before-crash');
      before.recoveryControlAbsent = before.recoveryControlPresent === false;
    } else if (config.phase === 'recover') {
      stage = 'inspect_interrupted_lifecycle';
      before = await readLifecycle(window.webContents, 'recovery_available');
      before.visual = await captureVisual(window, config, 'before-recovery');

      stage = 'click_recovery';
      const clicked = await clickRecovery(window.webContents);
      if (!clicked) throw new Error('recovery_control_not_clickable');

      stage = 'wait_recovered_lifecycle';
      after = await readLifecycle(window.webContents, 'ready');
      after.visual = await captureVisual(window, config, 'after-recovery');
      after.recoveryControlAbsent = after.recoveryControlPresent === false;
    } else {
      stage = 'inspect_reopened_lifecycle';
      before = await readLifecycle(window.webContents, 'ready');
      await pause(750);
      after = await readLifecycle(window.webContents, 'ready');
      after.visual = await captureVisual(window, config, 'reopened-ready');
      after.recoveryControlAbsent = after.recoveryControlPresent === false;
    }

    const publicProjectionClean = [before, after].filter(Boolean).every((snapshot) => (
      Object.values(snapshot.publicProjectionAudit).every((value) => value === false)
    ));
    const phasePassed = config.phase === 'active-crash'
      ? before.lifecycleState === 'ready'
        && before.activeOperationExplained
        && before.activeStageExplained
        && before.recoveryControlAbsent
        && recoveryRequests.length === 0
        && before.visual.nonblank
        && publicProjectionClean
      : config.phase === 'recover'
        ? before.detectedInterruptedSite
        && before.stoppingStageExplained
        && before.preservedCandidateCountExplained
        && before.automaticHandlingExplained
        && before.nextActionExplained
        && before.recoveryControlEnabled
        && after.lifecycleState === 'ready'
        && after.readyStateExplained
        && after.recoveryControlAbsent
        && recoveryRequests.length === 1
        && recoveryRequests[0] === 200
        && before.visual.nonblank
        && after.visual.nonblank
        && publicProjectionClean
      : before.lifecycleState === 'ready'
        && after.lifecycleState === 'ready'
        && before.readyStateExplained
        && after.readyStateExplained
        && after.recoveryControlAbsent
        && recoveryRequests.length === 0
        && after.visual.nonblank
        && publicProjectionClean;
    const backendStatus = backendStatusObservation();
    const passed = phasePassed
      && backendStatus.checkCount > 0
      && backendStatus.everyCheckReady === true;
    const result = {
      schemaVersion: 1,
      phase: config.phase,
      browserWindowSecurity: {
        contextIsolation: window.webContents.getLastWebPreferences().contextIsolation === true,
        nodeIntegrationDisabled: window.webContents.getLastWebPreferences().nodeIntegration === false,
        sandbox: window.webContents.getLastWebPreferences().sandbox === true,
        popupDenied: true,
      },
      before,
      after,
      recoveryRequestCount: recoveryRequests.length,
      recoveryRequestStatuses: recoveryRequests,
      interactionRequests,
      blockedNavigationCount: blockedNavigations.length,
      renderProcessGoneCount: rendererGone.length,
      publicProjectionClean,
      backendStatus,
      isolatedCompatibility: compatibilityObservation(),
      passed,
    };
    writeFileSync(config.resultPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    if (!passed) process.exitCode = 1;
    if (config.phase === 'active-crash' && passed) {
      // The parent process owns the deliberate SIGKILL. Staying alive here
      // proves the persisted observation came from an active Electron process.
      await new Promise(() => {});
    }
  } catch (error) {
    let lifecycle = null;
    let rendererState = null;
    try {
      lifecycle = await window.webContents.executeJavaScript(lifecycleExpression(), true);
      if (lifecycle && typeof lifecycle === 'object') delete lifecycle.text;
    } catch {}
    try {
      rendererState = await window.webContents.executeJavaScript(rendererStateExpression(), true);
    } catch {}
    writeFileSync(config.resultPath, `${JSON.stringify({
      schemaVersion: 1,
      phase: config.phase,
      failedStage: stage,
      errorCode: String(error?.message || 'unknown').split(':', 1)[0],
      lifecycle,
      rendererState,
      interactionRequests,
      backendStatus: backendStatusObservation(),
      isolatedCompatibility: compatibilityObservation(),
      passed: false,
    }, null, 2)}\n`, { mode: 0o600 });
    if (rendererState) console.error(`renderer-state:${JSON.stringify(rendererState)}`);
    console.error(`interaction-requests:${JSON.stringify(interactionRequests)}`);
    console.error(error?.stack || error);
    process.exitCode = 1;
  } finally {
    window.destroy();
    app.quit();
  }
}

app.whenReady().then(run).catch((error) => {
  console.error(error?.stack || error);
  app.exit(1);
});
