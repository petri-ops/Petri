#!/usr/bin/env node
'use strict';

const { createHash } = require('node:crypto');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const CONFIG_ENV = 'BIOF3_SDC1_DRIVER_CONFIG';
const PRELOAD_PATH = path.resolve(__dirname, '..', 'src', 'preload.js');
const AI_SETTINGS_HELPER_PATH = path.resolve(__dirname, '..', 'core', 'r-server', 'helpers', 'ai-settings.js');
const CHAT_INPUT_SELECTOR = 'textarea[placeholder="输入消息… (Enter 发送, Shift+Enter 换行)"]';
const SEND_BUTTON_SELECTOR = 'button.sc-send-cta-send[title="发送消息"]';
const POLL_MS = 125;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readConfig() {
  const configPath = process.env[CONFIG_ENV];
  if (!configPath || !path.isAbsolute(configPath)) throw new Error(`${CONFIG_ENV} is required`);
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  for (const key of ['uiBaseUrl', 'backendBaseUrl', 'projectId', 'resultPath', 'outputDir', 'countsSourcePath', 'metadataSourcePath']) {
    if (typeof config[key] !== 'string' || !config[key]) throw new Error(`driver config missing ${key}`);
  }
  if (config.electronUserDataPath === undefined) {
    config.electronUserDataPath = path.join(config.outputDir, 'electron-user-data');
  }
  if (typeof config.electronUserDataPath !== 'string' || !path.isAbsolute(config.electronUserDataPath)) {
    throw new Error('electronUserDataPath must be an absolute path');
  }
  for (const key of ['uiBaseUrl', 'backendBaseUrl']) {
    const parsed = new URL(config[key]);
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port) {
      throw new Error(`${key} must be an isolated loopback URL`);
    }
  }
  return config;
}

async function waitFor(webContents, expression, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await webContents.executeJavaScript(expression, true);
      if (last) return last;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await pause(POLL_MS);
  }
  throw new Error(`timed out waiting for ${label}; last=${JSON.stringify(last)}`);
}

async function clickButton(webContents, predicate, label) {
  const clicked = await webContents.executeJavaScript(`
    (() => {
      const button = [...document.querySelectorAll('button')].find((item) => ${predicate});
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()
  `, true);
  if (!clicked) throw new Error(`could not click ${label}`);
}

async function dismissOnboarding(webContents) {
  await waitFor(webContents, `document.readyState === 'complete' || document.readyState === 'interactive'`, 'renderer');
  const outcome = await waitFor(webContents, `
    (() => {
      const completed = localStorage.getItem('biof3-onboarding-completed') === '1';
      const dialog = document.querySelector('[role="dialog"][aria-label="首次启动引导"]');
      if (completed && !dialog) return { state: 'already_completed' };
      const button = dialog && [...dialog.querySelectorAll('button')]
        .find((item) => (item.textContent || '').trim() === '跳过引导');
      if (!button) return null;
      button.click();
      return { state: 'dismissed' };
    })()
  `, 'first-run onboarding');
  if (outcome.state === 'dismissed') {
    await waitFor(webContents, `
      localStorage.getItem('biof3-onboarding-completed') === '1'
        && !document.querySelector('[role="dialog"][aria-label="首次启动引导"]')
    `, 'first-run onboarding dismissal');
  }
}

async function uploadFixtureFiles(webContents, config) {
  const files = [
    {
      name: config.countsUploadName || 'counts.csv',
      type: 'text/csv',
      base64: readFileSync(config.countsSourcePath).toString('base64'),
    },
    {
      name: config.metadataUploadName || 'metadata.csv',
      type: 'text/csv',
      base64: readFileSync(config.metadataSourcePath).toString('base64'),
    },
  ];
  const uploaded = await webContents.executeJavaScript(`
    (() => {
      const input = document.querySelector('input[type="file"][multiple]');
      if (!input) return false;
      const transfer = new DataTransfer();
      const files = ${JSON.stringify(files)};
      for (const file of files) {
        const binary = atob(file.base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        transfer.items.add(new File([bytes], file.name, { type: file.type }));
      }
      const selectedCount = transfer.files.length;
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return selectedCount;
    })()
  `, true);
  if (uploaded !== 2) throw new Error('fixture upload did not select exactly two files');
}

async function submitChat(webContents, message) {
  const accepted = await webContents.executeJavaScript(`
    (() => {
      const input = document.querySelector(${JSON.stringify(CHAT_INPUT_SELECTOR)});
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(message)});
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(message)} }));
      return true;
    })()
  `, true);
  if (!accepted) throw new Error('chat input unavailable');
  await waitFor(webContents,
    `[...document.querySelectorAll(${JSON.stringify(SEND_BUTTON_SELECTOR)})].some((item) => !item.disabled)`,
    'enabled send command');
  await clickButton(webContents, `item.matches(${JSON.stringify(SEND_BUTTON_SELECTOR)})`, 'send message');
}

async function backendJson(url) {
  const response = await fetch(url, { headers: { Authorization: 'Bearer desktop-local' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `backend request failed: ${response.status}`);
  return data;
}

function registerAiSettingsIpc(ipcMain, aiSettings = require(AI_SETTINGS_HELPER_PATH)) {
  const removeExisting = (channel) => {
    try { ipcMain.removeHandler(channel); } catch {}
  };

  removeExisting('ai-settings:get');
  ipcMain.handle('ai-settings:get', async () => {
    try {
      return aiSettings.getAiSettings();
    } catch {
      return {};
    }
  });

  removeExisting('ai-settings:save');
  ipcMain.handle('ai-settings:save', async (_event, settings) => {
    try {
      aiSettings.saveAiSettings(settings);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  removeExisting('ai-settings:get-credential');
  ipcMain.handle('ai-settings:get-credential', async (_event, credentialId) => {
    try {
      return { ok: true, apiKey: aiSettings.getApiKey(String(credentialId || '')) };
    } catch (error) {
      return { ok: false, apiKey: '', error: error instanceof Error ? error.message : String(error) };
    }
  });

  removeExisting('ai-settings:test');
  ipcMain.handle('ai-settings:test', async (_event, providerOrProfile, apiKey) => {
    try {
      return await aiSettings.testApiKey(providerOrProfile, apiKey);
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });

  removeExisting('ai-settings:list-models');
  ipcMain.handle('ai-settings:list-models', async (_event, providerOrProfile, apiKey) => {
    try {
      return await aiSettings.listAvailableModels(providerOrProfile, apiKey);
    } catch (error) {
      return { ok: false, models: [], message: error instanceof Error ? error.message : String(error) };
    }
  });

  return [
    'ai-settings:get',
    'ai-settings:save',
    'ai-settings:get-credential',
    'ai-settings:test',
    'ai-settings:list-models',
  ];
}

async function run(config) {
  if (!config || typeof config !== 'object') throw new Error('resolved driver config is required');
  mkdirSync(config.outputDir, { recursive: true });
  const checkpoint = (nextStage) => {
    stage = nextStage;
    writeFileSync(config.resultPath, `${JSON.stringify({ schemaVersion: 1, passed: false, stage })}\n`);
  };
  const { BrowserWindow, ipcMain } = require('electron');
  registerAiSettingsIpc(ipcMain);
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: config.show === true,
    title: 'BioF3 SDC1 isolated trace',
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: PRELOAD_PATH,
    },
  });
  const wc = window.webContents;
  let stage = 'starting';
  checkpoint(stage);
  try {
    await window.loadURL(`${config.uiBaseUrl}/project/${encodeURIComponent(config.projectId)}?mode=chat`);
    await dismissOnboarding(wc);
    await waitFor(wc, `Boolean(document.querySelector(${JSON.stringify(CHAT_INPUT_SELECTOR)}))`, 'chat composer');
    checkpoint('workspace_ready');

    await clickButton(wc, `(item.textContent || '').includes('浏览项目目录')`, 'file workspace');
    await waitFor(wc, `[...document.querySelectorAll('button')].some((item) => item.getAttribute('aria-label') === '导入数据')`, 'data import');
    await clickButton(wc, `item.getAttribute('aria-label') === '导入数据'`, 'data import');
    await waitFor(wc, `Boolean(document.querySelector('input[type="file"][multiple]'))`, 'file input');
    checkpoint('import_open');
    await uploadFixtureFiles(wc, config);
    const acceptImportedOnly = config.allowNonActionableData === true;
    const readiness = await waitFor(wc, `
      (() => {
        const panel = document.querySelector('[aria-label="数据准备"]');
        if (!panel) return null;
        const text = panel.textContent || '';
        const start = [...panel.querySelectorAll('button')].find((item) => (item.textContent || '').includes('开始分析'));
        const fileCount = panel.querySelectorAll('strong[title^="data/"]').length;
        const ready = text.includes('可开始分析') && start && !start.disabled;
        return (ready || (${JSON.stringify(acceptImportedOnly)} && fileCount === 2))
          ? { fileCount, ready, imported: fileCount === 2 }
          : null;
      })()
    `, acceptImportedOnly ? 'two imported data files' : 'actionable data readiness');
    checkpoint(readiness.ready ? 'data_ready' : 'data_imported');
    const readyPng = (await window.webContents.capturePage()).toPNG();
    const readyScreenshot = path.join(config.outputDir, 'data-ready.png');
    writeFileSync(readyScreenshot, readyPng);

    if (config.initialAnalysisMessage) {
      await clickButton(
        wc,
        `item.getAttribute('aria-label') === '关闭' && Boolean(item.closest('[aria-label="数据准备"]'))`,
        'close data preparation'
      );
      await submitChat(wc, config.initialAnalysisMessage);
    } else {
      await clickButton(wc, `(item.textContent || '').includes('开始分析')`, 'start analysis');
    }
    const confirmationText = config.expectedConfirmationText || '请确认：design 使用 condition';
    await waitFor(wc, `
      [...document.querySelectorAll('.sc-msg-assistant')]
        .some((item) => (item.textContent || '').includes(${JSON.stringify(confirmationText)}))
    `, 'scientific confirmation request', 90_000);
    checkpoint('confirmation_requested');

    await submitChat(
      wc,
      config.confirmationMessage || '确认：design=condition，对照组=WT，实验组=KO。请执行 DESeq2。'
    );
    await waitFor(wc, `
      (() => {
        const query = new URLSearchParams(location.search);
        const canvas = document.querySelector('[aria-label="结果主画布"]');
        if (query.get('mode') !== 'result' || !query.get('job') || !canvas) return null;
        const image = [...canvas.querySelectorAll('img')]
          .find((item) => item.complete && item.naturalWidth > 0 && item.naturalHeight > 0);
        const body = image || canvas.querySelector('table, iframe, pre, [role="img"], [data-viewer]');
        return body ? { resultOpen: true, imageVisible: Boolean(image) } : null;
      })()
    `, 'automatic result opening', 8 * 60 * 1000);
    checkpoint('result_open');

    const uiTruth = await wc.executeJavaScript(`
      (() => {
        const query = new URLSearchParams(location.search);
        const canvas = document.querySelector('[aria-label="结果主画布"]');
        const image = [...(canvas?.querySelectorAll('img') || [])]
          .find((item) => item.complete && item.naturalWidth > 0 && item.naturalHeight > 0);
        return {
          mode: query.get('mode'),
          jobId: query.get('job'),
          artifact: query.get('artifact'),
          canvasPresent: Boolean(canvas),
          bodyVisible: Boolean(image || canvas?.querySelector('table, iframe, pre, [role="img"], [data-viewer]')),
          imageVisible: Boolean(image),
          assistantConfirmed: [...document.querySelectorAll('.sc-msg-assistant')]
            .some((item) => (item.textContent || '').includes('DESeq2 已完成')),
        };
      })()
    `, true);
    const resultPng = (await window.webContents.capturePage()).toPNG();
    writeFileSync(path.join(config.outputDir, 'result-open.png'), resultPng);
    let summaryPresentation = null;
    let chatPng = null;
    if (config.expectedAssistantText) {
      await clickButton(wc, `item.getAttribute('aria-label') === '返回对话'`, 'return to chat');
      await waitFor(wc, `
        [...document.querySelectorAll('.sc-msg-assistant')]
          .some((item) => (item.textContent || '').includes(${JSON.stringify(config.expectedAssistantText)}))
      `, 'tool success summary-unavailable message', 4 * 60 * 1000);
      await clickButton(
        wc,
        `item.matches('.sc-tool-activity-summary') && item.getAttribute('aria-expanded') === 'false'`,
        'expand completed tool activity'
      );
      await waitFor(wc, `Boolean(document.querySelector('.sc-tool-activity-success'))`, 'completed tool activity');
      summaryPresentation = await wc.executeJavaScript(`
        (() => {
          const expected = ${JSON.stringify(config.expectedAssistantText)};
          const forbidden = ${JSON.stringify(config.forbiddenAssistantText || '')};
          const messages = [...document.querySelectorAll('.sc-msg-assistant')];
          const target = messages.find((item) => (item.textContent || '').includes(expected));
          const visibleForbidden = forbidden
            ? messages.some((item) => (item.textContent || '').includes(forbidden))
            : false;
          const successfulTool = [...document.querySelectorAll('.sc-tool-activity-success')].length > 0;
          return {
            expectedVisible: Boolean(target),
            forbiddenVisible: visibleForbidden,
            successfulTool,
            text: (target?.textContent || '').trim().slice(0, 500),
            mode: new URLSearchParams(location.search).get('mode'),
          };
        })()
      `, true);
      chatPng = (await window.webContents.capturePage()).toPNG();
      writeFileSync(path.join(config.outputDir, 'summary-unavailable.png'), chatPng);
    }
    const jobsPayload = await backendJson(`${config.backendBaseUrl}/api/data/projects/${encodeURIComponent(config.projectId)}/jobs`);
    const jobs = Array.isArray(jobsPayload.jobs) ? jobsPayload.jobs : [];
    const completed = jobs.filter((job) => job.tool_id === 'deseq2' && job.status === 'completed');
    if (completed.length !== 1) throw new Error(`expected one completed deseq2 job, got ${completed.length}`);
    const job = completed[0];
    const statusPayload = await backendJson(`${config.backendBaseUrl}/api/tools/status/${encodeURIComponent(job.id)}`);
    const statusJob = statusPayload.job || statusPayload.data?.job || statusPayload.data || statusPayload;
    const result = statusJob.result || statusJob.result_json || job.result || {};
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;
    const artifactTruth = parsedResult.artifactTruth || statusPayload.artifactTruth;

    const evidence = {
      schemaVersion: 1,
      renderer: `Electron ${process.versions.electron} / Chromium ${process.versions.chrome}`,
      importedFileCount: readiness.fileCount,
      dataReady: readiness.ready === true,
      dataImported: readiness.imported === true,
      analysisInitiatedBy: config.initialAnalysisMessage ? 'explicit_chat' : 'data_intake_control',
      scientificConfirmationRequested: true,
      execution: {
        tool: 'deseq2',
        completedJobCount: completed.length,
        artifactTruthStatus: artifactTruth?.status || null,
        artifactTruthBlocking: artifactTruth?.blocking === true,
      },
      automaticResultOpen: {
        exactJob: uiTruth.jobId === job.id,
        mode: uiTruth.mode,
        canvasPresent: uiTruth.canvasPresent,
        bodyVisible: uiTruth.bodyVisible,
        imageVisible: uiTruth.imageVisible,
        assistantConfirmed: uiTruth.assistantConfirmed,
      },
      ...(summaryPresentation ? { summaryPresentation } : {}),
      screenshots: {
        dataReady: { file: 'data-ready.png', sha256: sha256(readyPng), bytes: readyPng.length },
        resultOpen: { file: 'result-open.png', sha256: sha256(resultPng), bytes: resultPng.length },
        ...(chatPng ? {
          summaryUnavailable: {
            file: 'summary-unavailable.png',
            sha256: sha256(chatPng),
            bytes: chatPng.length,
          },
        } : {}),
      },
    };
    evidence.passed = evidence.importedFileCount === 2
      && (evidence.dataReady || (config.allowNonActionableData === true && evidence.dataImported))
      && evidence.scientificConfirmationRequested
      && evidence.execution.completedJobCount === 1
      && evidence.execution.artifactTruthStatus === 'valid'
      && evidence.execution.artifactTruthBlocking === false
      && evidence.automaticResultOpen.exactJob
      && evidence.automaticResultOpen.mode === 'result'
      && evidence.automaticResultOpen.canvasPresent
      && evidence.automaticResultOpen.bodyVisible
      && (!config.expectedAssistantText || (
        evidence.summaryPresentation?.expectedVisible === true
        && evidence.summaryPresentation?.forbiddenVisible === false
        && evidence.summaryPresentation?.successfulTool === true
        && evidence.summaryPresentation?.mode === 'chat'
      ));
    writeFileSync(config.resultPath, `${JSON.stringify(evidence, null, 2)}\n`);
    window.destroy();
    return evidence;
  } catch (error) {
    let page = null;
    try {
      page = await wc.executeJavaScript(`
        ({
          url: location.href,
          title: document.title,
          text: (document.body?.innerText || '').slice(0, 1200),
          dialogs: document.querySelectorAll('[role="dialog"]').length,
          textareas: document.querySelectorAll('textarea').length,
        })
      `, true);
      const failedPng = (await wc.capturePage()).toPNG();
      writeFileSync(path.join(config.outputDir, 'driver-failed.png'), failedPng);
    } catch {}
    writeFileSync(config.resultPath, `${JSON.stringify({
      schemaVersion: 1,
      passed: false,
      stage,
      error: error instanceof Error ? error.message : String(error),
      page,
    }, null, 2)}\n`);
    window.destroy();
    throw error;
  }
}

const invokedAsElectronEntry = process.argv.some((argument) => {
  try { return path.resolve(argument) === __filename; } catch { return false; }
});

if (require.main === module || invokedAsElectronEntry) {
  const { app } = require('electron');
  const config = readConfig();
  mkdirSync(config.electronUserDataPath, { recursive: true });
  app.setPath('userData', config.electronUserDataPath);
  app.whenReady()
    .then(() => run(config))
    .then(() => app.quit())
    .catch((error) => {
      console.error(error?.stack || error);
      app.exit(1);
    });
}

module.exports = { readConfig, registerAiSettingsIpc, run };
