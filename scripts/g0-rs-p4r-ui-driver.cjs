#!/usr/bin/env node
'use strict';

/**
 * Electron-side driver for the P4R-6 renderer observation.
 *
 * The parent process owns corpus/backend/Vite lifecycle and passes only a
 * disposable config path. This process owns one BrowserWindow, performs real
 * Chromium layout/focus/capture checks, writes a bounded result into the same
 * disposable root, and exits. No project identifiers, URLs or DOM text are
 * persisted in the result.
 */

const { app, BrowserWindow, session } = require('electron');
const { createHash } = require('node:crypto');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const CONFIG_ENV = 'BIOF3_P4R_UI_DRIVER_CONFIG';
const WAIT_TIMEOUT_MS = 45_000;
const POLL_MS = 100;
const controlLines = [];
const controlWaiters = [];
let controlBuffer = '';
// 失败诊断：catch 落盘时带上最后一个通过 checkpoint，否则「阶段首段即失败」
// 只能靠栈帧猜（页面世界抛来的跨域异常连栈帧都没有，如 UnknownVizError）。
let driverLastStage = 'starting';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  controlBuffer += chunk;
  const lines = controlBuffer.split(/\r?\n/);
  controlBuffer = lines.pop() || '';
  for (const line of lines) {
    const index = controlWaiters.findIndex((item) => item.expected === line);
    if (index < 0) {
      if (line) controlLines.push(line);
      continue;
    }
    const [waiter] = controlWaiters.splice(index, 1);
    clearTimeout(waiter.timer);
    waiter.resolve();
  }
});

function waitForControlLine(expected, timeoutMs = WAIT_TIMEOUT_MS) {
  const index = controlLines.indexOf(expected);
  if (index >= 0) {
    controlLines.splice(index, 1);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const waiter = { expected, resolve, timer: null };
    waiter.timer = setTimeout(() => {
      const active = controlWaiters.indexOf(waiter);
      if (active >= 0) controlWaiters.splice(active, 1);
      reject(new Error(`timed out waiting for parent control line ${expected}`));
    }, timeoutMs);
    controlWaiters.push(waiter);
  });
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function readConfig() {
  const configPath = process.env[CONFIG_ENV];
  if (!configPath || !path.isAbsolute(configPath)) {
    throw new Error(`${CONFIG_ENV} must point to an absolute disposable config path`);
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  for (const key of ['url', 'outputDir', 'resultPath', 'requestedOutcome']) {
    if (typeof config[key] !== 'string' || !config[key]) throw new Error(`driver config missing ${key}`);
  }
  if (!config.url.startsWith('http://127.0.0.1:3000/project/')) {
    throw new Error('driver only accepts the isolated local P4R project URL');
  }
  return config;
}

async function waitFor(webContents, expression, label, timeoutMs = WAIT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await webContents.executeJavaScript(expression, true);
      if (last) return last;
    } catch (error) {
      last = error && error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`timed out waiting for ${label}; last=${JSON.stringify(last)}`);
}

async function setTheme(webContents, theme) {
  await webContents.executeJavaScript(`
    (() => {
      localStorage.setItem('biof3-theme', ${JSON.stringify(theme)});
      window.dispatchEvent(new CustomEvent('gewu:theme-change', {
        detail: { preference: ${JSON.stringify(theme)} }
      }));
      return true;
    })()
  `, true);
  await waitFor(
    webContents,
    `document.documentElement.dataset.theme === ${JSON.stringify(theme)}`,
    `theme ${theme}`,
  );
}

async function semanticSnapshot(webContents) {
  const snapshot = await webContents.executeJavaScript(`
    (() => {
      const visible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const canvas = document.querySelector('[aria-label="结果主画布"]');
      const context = canvas && canvas.querySelector('header');
      const active = document.activeElement;
      const buttons = canvas
        ? [...canvas.querySelectorAll('button')].filter(visible)
        : [];
      const bodyText = document.body.innerText || '';
      const rect = canvas ? canvas.getBoundingClientRect() : null;
      const firstVisibleRaw = canvas && canvas.getAttribute('data-first-visible-ms');
      const title = context && context.querySelector('h2');
      const versionText = context
        ? [...context.querySelectorAll('span')].map((item) => item.textContent || '')
          .find((text) => /^(当前版本|v\\d+)$/.test(text.trim())) || ''
        : '';
      const truth = context && context.querySelector('[data-tone]');
      const bodyCandidates = canvas
        ? [...canvas.querySelectorAll(
          'img, table, iframe, pre, [role="img"], [data-viewer], main, article, [class*="resultSidebarPreviewBody"] > *',
        )]
        : [];
      const degradationCandidates = canvas
        ? [...canvas.querySelectorAll('[role="alert"], [data-state="blocked"], [data-state="unavailable"]')]
        : [];
      const composer = document.querySelector('[aria-label="用 Agent 修改当前结果"]');
      return {
        theme: document.documentElement.dataset.theme || null,
        viewport: {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        },
        canvas: rect ? {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          mode: canvas.getAttribute('data-mode'),
          firstVisibleMs: firstVisibleRaw && Number.isFinite(Number(firstVisibleRaw))
            ? Number(firstVisibleRaw)
            : null,
        } : null,
        bodyVisible: bodyCandidates.some((candidate) => visible(candidate)),
        degradationVisible: degradationCandidates.some((candidate) => visible(candidate)),
        composerState: composer ? composer.getAttribute('data-state') : 'absent',
        titleText: title ? (title.textContent || '').trim().slice(0, 160) : null,
        versionKind: /^v\\d+$/.test(versionText.trim()) ? 'ordinal' : versionText.trim() === '当前版本' ? 'fallback' : 'missing',
        truthKind: truth ? (truth.getAttribute('data-tone') || 'present') : 'missing',
        visiblePrimaryActionCount: buttons.filter((button) => {
          const text = (button.textContent || '').trim();
          return /采用|放弃|撤销|恢复|确认重放|交给 Agent/.test(text)
            && !button.closest('[class*="lifecycle"], [role="alert"]');
        }).length,
        activeElement: active ? {
          tag: active.tagName.toLowerCase(),
          ariaLabel: active.getAttribute('aria-label') || null,
          text: (active.textContent || '').trim().slice(0, 120),
        } : null,
        internalLeakFlags: {
          absolutePath: /(?:\\/Users\\/|\\/home\\/|[A-Za-z]:\\\\)/.test(bodyText),
          credential: /(?:sk-[A-Za-z0-9]{12,}|api[_ -]?key\\s*[:=])/i.test(bodyText),
          rawInternalId: /\\b(?:rev|cs|tj|sel|conv)_[a-z0-9_-]{6,}\\b/i.test(bodyText),
        },
      };
    })()
  `, true);
  snapshot.titleDigest = snapshot.titleText ? digest(snapshot.titleText) : null;
  delete snapshot.titleText;
  if (snapshot.activeElement) {
    snapshot.activeElement.textDigest = digest(snapshot.activeElement.text || '');
    delete snapshot.activeElement.text;
  }
  return snapshot;
}

async function captureState(window, outputDir, label, theme, width, height) {
  window.setSize(width, height, false);
  await new Promise((resolve) => setTimeout(resolve, 180));
  await setTheme(window.webContents, theme);
  const snapshot = await semanticSnapshot(window.webContents);
  if (!snapshot.canvas) throw new Error(`${label}: Result Studio canvas is absent`);
  const image = await window.webContents.capturePage();
  const png = image.toPNG();
  const file = `${label}.png`;
  writeFileSync(path.join(outputDir, file), png);
  return {
    label,
    theme,
    requestedSize: { width, height },
    screenshot: file,
    screenshotSha256: digest(png),
    screenshotBytes: png.length,
    domSha256: digest(JSON.stringify(snapshot)),
    ...snapshot,
    pageHorizontalOverflow: snapshot.viewport.scrollWidth > snapshot.viewport.clientWidth,
  };
}

async function clickMode(webContents, labels, timeoutMs = 15_000) {
  // 模式切换按钮存在两组现契约文案：CompactResultNavigator（result 模式下唯一
  // nav）用短标签「审查/历史」；ResultStudioContextBar（仅非 result 模式挂载，
  // CenterPanel contextBar 槽）用长标签「审查修改/版本历史」。contextBar 随模式
  // 挂载/卸载，且两条 nav 同为 aria-label="结果视图"，所以点击必须跨全部 nav
  // 做「标签变体 × 有界重试」，不能只查第一条 nav 或单一文案。
  const wanted = Array.isArray(labels) ? labels : [labels];
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const clicked = await webContents.executeJavaScript(`
      (() => {
        const wanted = ${JSON.stringify(wanted)};
        for (const nav of document.querySelectorAll('nav[aria-label="结果视图"]')) {
          const button = [...nav.querySelectorAll('button')]
            .find((item) => wanted.includes((item.textContent || '').trim()));
          if (button) {
            button.click();
            return true;
          }
        }
        return false;
      })()
    `, true);
    if (clicked) return;
    if (Date.now() >= deadline) {
      const diagnostics = await webContents.executeJavaScript(`
        (() => ({
          navs: [...document.querySelectorAll('nav[aria-label="结果视图"]')].map((nav) => ({
            buttons: [...nav.querySelectorAll('button')].map((item) => (item.textContent || '').trim()),
          })),
          canvasMode: document.querySelector('[aria-label="结果主画布"]')?.getAttribute('data-mode') || null,
          bodyHead: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 400),
        }))()
      `, true).catch(() => null);
      console.error(`[p4r-ui-driver] mode button missing: ${JSON.stringify(diagnostics)}`);
      throw new Error(`mode button not found: ${wanted.join('/')}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function sendTrustedKey(webContents, {
  key,
  code,
  virtualKeyCode,
  text = '',
}) {
  if (!webContents.debugger.isAttached()) webContents.debugger.attach('1.3');
  await webContents.debugger.sendCommand('Page.bringToFront');
  await webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key,
    code,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
  });
  if (text) {
    await webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
      type: 'char',
      key,
      code,
      text,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
    });
  }
  await webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
  });
}

async function keyboardTrace(window) {
  const wc = window.webContents;
  window.show();
  window.focus();
  wc.focus();
  await new Promise((resolve) => setTimeout(resolve, 120));
  const modeActivation = await wc.executeJavaScript(`
    (() => {
      const nav = document.querySelector('nav[aria-label="结果视图"]');
      const button = nav && [...nav.querySelectorAll('button')]
        .find((item) => (item.textContent || '').trim() === '代码');
      if (!button) return null;
      button.focus();
      const style = getComputedStyle(button);
      return {
        focused: document.activeElement === button,
        focusVisible: style.outlineStyle !== 'none' || style.boxShadow !== 'none',
      };
    })()
  `, true);
  if (!modeActivation?.focused) throw new Error('could not focus the Result Studio mode switcher');
  await sendTrustedKey(wc, {
    key: 'Enter',
    code: 'Enter',
    virtualKeyCode: 13,
    text: '\r',
  });
  await waitFor(
    wc,
    `document.querySelector('[aria-label="结果主画布"]')?.getAttribute('data-mode') === 'code'`,
    'keyboard code activation',
    5_000,
  );
  await clickMode(wc, '结果');

  const steps = [];
  for (let index = 0; index < 4; index += 1) {
    steps.push(await semanticSnapshot(wc).then((snapshot) => snapshot.activeElement));
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  const scatter = await wc.executeJavaScript(`
    (() => {
      const point = document.querySelector('[aria-label="可选择科学散点图"] [role="button"][tabindex="0"]');
      if (!point) return { available: false };
      point.focus();
      return {
        available: true,
        focused: document.activeElement === point,
        before: point.getAttribute('aria-pressed'),
      };
    })()
  `, true);
  let scatterActivated = false;
  if (scatter?.available && scatter.focused) {
    await sendTrustedKey(wc, {
      key: ' ',
      code: 'Space',
      virtualKeyCode: 32,
      text: ' ',
    });
    scatterActivated = await waitFor(
      wc,
      `document.activeElement?.getAttribute('role') === 'button'
        && document.activeElement?.getAttribute('aria-pressed') !== ${JSON.stringify(scatter.before)}`,
      'keyboard scatter activation',
      5_000,
    ).then(Boolean);
  }
  const result = {
    steps,
    modeEnterActivated: true,
    focusVisible: modeActivation.focusVisible,
    scatterAvailable: scatter?.available === true,
    scatterActivated,
    allFocusable: steps.every((item) => item && ['button', 'textarea', 'select', 'input', 'a'].includes(item.tag))
      && modeActivation.focusVisible
      && scatter?.available === true
      && scatterActivated,
  };
  window.hide();
  return result;
}

async function setComposerDraft(webContents, value) {
  return webContents.executeJavaScript(`
    (() => {
      const textarea = document.querySelector('textarea[aria-label="描述你希望当前结果发生什么变化"]');
      if (!textarea) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, ${JSON.stringify(value)});
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return textarea.value === ${JSON.stringify(value)};
    })()
  `, true);
}

async function reopenResultTrace(window, requestedOutcome) {
  const wc = window.webContents;
  if (!await setComposerDraft(wc, requestedOutcome)) throw new Error('could not enter the Agent request draft');
  const jobId = await wc.executeJavaScript(`new URL(location.href).searchParams.get('job')`, true);
  const artifactName = await wc.executeJavaScript(`new URL(location.href).searchParams.get('artifact')`, true);
  if (typeof jobId !== 'string' || !jobId) throw new Error('open-result route is missing its transient job coordinate');
  if (typeof artifactName !== 'string' || !artifactName) throw new Error('open-result route is missing its transient artifact coordinate');
  const returned = await wc.executeJavaScript(`
    (() => {
      const button = document.querySelector('button[aria-label="返回对话"]');
      if (!button) return false;
      button.click();
      return true;
    })()
  `, true);
  if (!returned) throw new Error('return-to-conversation action is unavailable');
  await waitFor(wc, `!document.querySelector('[aria-label="结果主画布"]')`, 'conversation projection');

  const startedAt = performance.now();
  const dispatched = await wc.executeJavaScript(`
    (() => {
      // BLOCK-61 品牌改名：应用事件前缀已 biof3: → gewu:（frontend/src/lib/events.ts），
      // 旧名派发无人监听，重开结果等待会超时。
      window.dispatchEvent(new CustomEvent('gewu:project-open-artifact', {
        detail: {
          jobId: ${JSON.stringify(jobId)},
          artifactName: ${JSON.stringify(artifactName)}
        }
      }));
      window.dispatchEvent(new CustomEvent('gewu:project-open-result', {
        detail: { toolJobId: ${JSON.stringify(jobId)} }
      }));
      return true;
    })()
  `, true);
  if (!dispatched) throw new Error('could not dispatch the product open-result event');
  await waitFor(wc, `Boolean(document.querySelector('[aria-label="结果主画布"]'))`, 'result feedback');
  const feedbackMs = Number((performance.now() - startedAt).toFixed(3));
  await waitFor(
    wc,
    `document.querySelector('[aria-label="用 Agent 修改当前结果"]')?.getAttribute('data-state') === 'ready'`,
    'reopened Agent context',
  );
  const snapshot = await semanticSnapshot(wc);
  const draftPreserved = await wc.executeJavaScript(`
    document.querySelector('textarea[aria-label="描述你希望当前结果发生什么变化"]')?.value
      === ${JSON.stringify(requestedOutcome)}
  `, true);
  return {
    feedbackMs,
    firstContentVisibleMs: snapshot.canvas?.firstVisibleMs ?? null,
    domSha256: digest(JSON.stringify(snapshot)),
    draftPreserved,
    draftDigest: digest(requestedOutcome),
    ...snapshot,
  };
}

async function candidateLifecycleTrace(window) {
  const wc = window.webContents;
  // 版本/变更面板（含「采用此版本」）只在 compare/history 模式挂载
  // （ResultArtifactShell: mode === 'compare' || 'history'；result 模式右栏是产物
  // 详情）。先切「审查」再等候选——曾在 result 模式下等按钮，面板搬移后
  // 该等待恒超时。
  await clickMode(wc, ['审查', '审查修改']);
  await waitFor(
    wc,
    `document.querySelector('[aria-label="结果主画布"]')?.getAttribute('data-mode') === 'compare'`,
    'candidate compare',
  );
  await waitFor(
    wc,
    `Boolean([...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '采用此版本'))`,
    'deterministic Agent candidate',
  );
  const compare = await semanticSnapshot(wc);
  const compareActionable = await wc.executeJavaScript(`
    Boolean(document.querySelector('[aria-label="Result Studio 版本与变更"]'))
      && Boolean([...document.querySelectorAll('button')]
        .find((item) => (item.textContent || '').trim() === '采用此版本'))
  `, true);
  if (!await clickButtonByText(wc, '采用此版本')) throw new Error('candidate adopt action is unavailable');
  // UI-305 起采纳后产品契约=onRevisionActivated 自动跳回 result 模式展示已采用
  // 版本，compare 面板随之卸载（旧捕获时面板原地翻转状态，故旧驱动在 compare
  // 原地等「撤销本次采用」）。等跳转落定后切回「审查」，面板重挂时 adopted
  // change set 为首选选中项，「撤销本次采用」在场。
  await waitFor(
    wc,
    `document.querySelector('[aria-label="结果主画布"]')?.getAttribute('data-mode') === 'result'
      || Boolean([...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '撤销本次采用'))`,
    'post-adopt projection',
  );
  const postAdoptMode = await wc.executeJavaScript(
    `document.querySelector('[aria-label="结果主画布"]')?.getAttribute('data-mode') || null`,
    true,
  );
  if (postAdoptMode === 'result') {
    await clickMode(wc, ['审查', '审查修改']);
    await waitFor(
      wc,
      `document.querySelector('[aria-label="结果主画布"]')?.getAttribute('data-mode') === 'compare'`,
      'post-adopt compare reentry',
    );
  }
  await waitFor(
    wc,
    `Boolean([...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '撤销本次采用'))`,
    'candidate adoption',
  );
  const adopted = await semanticSnapshot(wc);
  if (!await clickButtonByText(wc, '撤销本次采用')) throw new Error('candidate undo action is unavailable');
  await waitFor(
    wc,
    `![...document.querySelectorAll('button')].some((item) => (item.textContent || '').trim() === '撤销本次采用')`,
    'candidate undo',
  );

  await clickMode(wc, ['历史', '版本历史']);
  await waitFor(
    wc,
    `document.querySelector('[aria-label="结果主画布"]')?.getAttribute('data-mode') === 'history'`,
    'history mode',
  );
  const restored = await wc.executeJavaScript(`
    (() => {
      const rows = [...document.querySelectorAll('[aria-label="Result Studio 版本与变更"] [class*="historyRow"]')];
      const row = rows.find((item) => /^v2(?:\\s|·|$)/.test((item.querySelector('strong')?.textContent || '').trim()));
      const button = row && [...row.querySelectorAll('button')]
        .find((item) => (item.textContent || '').trim() === '恢复为新版本');
      if (!button) return false;
      button.click();
      return true;
    })()
  `, true);
  if (!restored) throw new Error('v2 restore action is unavailable');
  // 与采纳同族：UI-305 起 restore 也经 onRevisionActivated 跳回 result 模式，
  // history 面板卸载——旧契约是面板原地刷新出「当前 v3」。等跳转（或原地刷新）
  // 落定后切回「历史」等「当前 v3」。
  await waitFor(
    wc,
    `document.querySelector('[aria-label="结果主画布"]')?.getAttribute('data-mode') === 'result'
      || [...document.querySelectorAll('[aria-label="Result Studio 版本与变更"] span')]
        .some((item) => (item.textContent || '').trim() === '当前 v3')`,
    'post-restore projection',
  );
  const postRestoreMode = await wc.executeJavaScript(
    `document.querySelector('[aria-label="结果主画布"]')?.getAttribute('data-mode') || null`,
    true,
  );
  if (postRestoreMode === 'result') {
    await clickMode(wc, ['历史', '版本历史']);
    await waitFor(
      wc,
      `document.querySelector('[aria-label="结果主画布"]')?.getAttribute('data-mode') === 'history'`,
      'post-restore history reentry',
    );
  }
  await waitFor(
    wc,
    `[...document.querySelectorAll('[aria-label="Result Studio 版本与变更"] span')]
      .some((item) => (item.textContent || '').trim() === '当前 v3')`,
    'restored v3',
  );

  await clickMode(wc, '代码');
  await waitFor(wc, `Boolean(document.querySelector('[aria-label="代码操作"]'))`, 'restored Revision code');
  const openedMenu = await wc.executeJavaScript(`
    (() => {
      const summary = [...document.querySelectorAll('summary')]
        .find((item) => (item.textContent || '').trim() === '交给 Agent');
      if (!summary) return false;
      summary.click();
      return true;
    })()
  `, true);
  if (!openedMenu || !await clickButtonByText(wc, '受控重放')) {
    throw new Error('controlled replay preflight action is unavailable');
  }
  await waitFor(wc, `Boolean(document.querySelector('[aria-label="受控重放确认"]'))`, 'controlled replay confirmation');
  if (!await clickButtonByText(wc, '确认受控重放')) throw new Error('controlled replay confirmation is unavailable');
  await waitFor(
    wc,
    `document.querySelector('[aria-label="结果主画布"]')?.getAttribute('data-mode') === 'compare'`,
    'replay candidate compare',
  );
  await waitFor(
    wc,
    `Boolean([...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '放弃候选'))`,
    'replay candidate',
  );
  if (!await clickButtonByText(wc, '放弃候选')) throw new Error('replay candidate discard is unavailable');
  await waitFor(
    wc,
    `![...document.querySelectorAll('button')].some((item) => (item.textContent || '').trim() === '放弃候选')`,
    'replay candidate discard',
  );
  await clickMode(wc, '结果');
  await waitFor(
    wc,
    `document.querySelector('[aria-label="用 Agent 修改当前结果"]')?.getAttribute('data-state') === 'ready'`,
    'post-lifecycle Agent context',
  );
  return {
    compareVisible: compareActionable,
    compareDigest: digest(JSON.stringify(compare)),
    adoptedVersionKind: adopted.versionKind,
    adopted: true,
    undone: true,
    restoredOrdinal: 3,
    replayConfirmed: true,
    replayCandidateDiscarded: true,
  };
}

async function serviceRestartTrace(window, canonicalUrl) {
  const wc = window.webContents;
  const before = await semanticSnapshot(wc);
  const webContentsId = wc.id;
  process.stdout.write('__P4R6_BACKEND_RESTART_REQUEST__\n');
  await waitForControlLine('__P4R6_BACKEND_STOPPED__');
  const unreachable = await wc.executeJavaScript(`
    fetch('http://localhost:3001/api/health').then(() => false).catch(() => true)
  `, true);
  process.stdout.write('__P4R6_BACKEND_RESTART_CONTINUE__\n');
  await waitForControlLine('__P4R6_BACKEND_RESTARTED__');
  await window.loadURL(canonicalUrl);
  await waitFor(wc, `Boolean(document.querySelector('[aria-label="结果主画布"]'))`, 'post-restart result canvas');
  await waitFor(
    wc,
    `document.querySelector('[aria-label="用 Agent 修改当前结果"]')?.getAttribute('data-state') === 'ready'`,
    'post-restart Agent context',
  );
  const after = await semanticSnapshot(wc);
  return {
    sameWebContents: wc.id === webContentsId,
    backendWasUnreachable: unreachable === true,
    resultRecovered: after.bodyVisible,
    composerRecovered: after.composerState === 'ready',
    versionRecovered: after.versionKind === 'ordinal',
    beforeDigest: digest(JSON.stringify(before)),
    afterDigest: digest(JSON.stringify(after)),
  };
}

async function clickButtonByText(webContents, text) {
  return webContents.executeJavaScript(`
    (() => {
      const button = [...document.querySelectorAll('button')]
        .find((item) => (item.textContent || '').trim() === ${JSON.stringify(text)});
      if (!button) return false;
      button.click();
      return true;
    })()
  `, true);
}

// keyboardTrace 结尾的 window.hide() 之后，合成器会对隐藏窗口停帧——capturePage
// 走 viz CopyOutputRequest 直接拒绝 UnknownVizError（Chromium CopyOutputResult
// Status，跨域无栈）。矩阵段（hide 之前）连捕 6 次不受影响。韧性回退：临时
// 显示窗口恢复帧产出再捕；不改变 DOM/语义态，窗口运行结束即销毁。
async function capturePageResilient(window) {
  try {
    return await window.webContents.capturePage();
  } catch (error) {
    window.show();
    await new Promise((resolve) => setTimeout(resolve, 300));
    return window.webContents.capturePage();
  }
}

async function captureFailureScreenshot(window, outputDir, kind) {
  const snapshot = await semanticSnapshot(window.webContents);
  const png = (await capturePageResilient(window)).toPNG();
  const screenshot = `failure-${kind}.png`;
  writeFileSync(path.join(outputDir, screenshot), png);
  return {
    kind,
    bodyPreserved: snapshot.bodyVisible,
    pageHorizontalOverflow: snapshot.viewport.scrollWidth > snapshot.viewport.clientWidth,
    domSha256: digest(JSON.stringify(snapshot)),
    screenshot,
    screenshotSha256: digest(png),
    screenshotBytes: png.length,
    degradationVisible: snapshot.degradationVisible,
    internalLeakFlags: snapshot.internalLeakFlags,
  };
}

// UI-122 起图像交互失败为渐进增强的静默降级（resultSurface.shouldSurfaceInteractionFailure
// 只对 table 报错；图像「failed discovery must leave the static plot quiet and usable」）。
// 旧契约（图像也出「重试交互能力」可行动恢复）已不存在——旧驱动在深链 volcano PNG 上等
// 重试按钮恒超时。本段按现契约断言：交互端点被拦时主体图像保持可见、无重试按钮、
// 无降级横幅、composer 仍就绪；解阻后重载恢复。
async function interactionQuietDegradationTrace(window, blocked, outputDir) {
  const wc = window.webContents;
  const routeFragment = '/api/result-studio/interaction';
  blocked.add(routeFragment);
  await wc.reload();
  await waitFor(wc, `Boolean(document.querySelector('[aria-label="结果主画布"]'))`, 'interaction quiet canvas');
  await waitFor(wc, `Boolean(document.querySelector('[aria-label="结果主画布"] img, [aria-label="结果主画布"] [role="img"]'))`, 'interaction quiet primary image');
  await waitFor(wc, `document.querySelector('[aria-label="用 Agent 修改当前结果"]')?.getAttribute('data-state') === 'ready'`, 'interaction quiet composer');
  const observation = await captureFailureScreenshot(window, outputDir, 'interaction-quiet');
  const quietState = await wc.executeJavaScript(`
    (() => ({
      retryButtonPresent: Boolean([...document.querySelectorAll('button')]
        .find((item) => (item.textContent || '').trim() === '重试交互能力')),
      degradationVisible: Boolean(document.querySelector('[role="alert"], [data-state="blocked"], [data-state="unavailable"]')),
    }))()
  `, true);
  blocked.delete(routeFragment);
  await wc.reload();
  await waitFor(wc, `Boolean(document.querySelector('[aria-label="结果主画布"] img, [aria-label="结果主画布"] [role="img"]'))`, 'interaction recovery primary image');
  await waitFor(wc, `document.querySelector('[aria-label="用 Agent 修改当前结果"]')?.getAttribute('data-state') === 'ready'`, 'interaction recovery composer');
  return {
    ...observation,
    quietByContract: !quietState.retryButtonPresent && !quietState.degradationVisible,
    imagePreserved: observation.bodyPreserved,
    recovered: true,
  };
}

async function retryableFailureTrace(window, blocked, outputDir, {
  kind,
  routeFragment,
  retryLabel,
  prepare,
  recoveredExpression,
  verifyPrimaryBody = false,
  waitForPrimaryBody = false,
}) {
  blocked.add(routeFragment);
  if (prepare) await prepare();
  else await window.webContents.reload();
  await waitFor(
    window.webContents,
    `Boolean([...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === ${JSON.stringify(retryLabel)}))`,
    `${kind} actionable failure`,
  );
  if (waitForPrimaryBody) {
    await waitFor(
      window.webContents,
      `Boolean(document.querySelector('[aria-label="结果主画布"] [class*="resultSidebarPreviewBody"] > *'))`,
      `${kind} independent primary result`,
    );
  }
  const observation = await captureFailureScreenshot(window, outputDir, kind);
  if (verifyPrimaryBody) {
    await clickMode(window.webContents, '结果');
    await waitFor(
      window.webContents,
      `Boolean(document.querySelector('[aria-label="结果主画布"] [class*="resultSidebarPreviewBody"] > *'))`,
      `${kind} primary result preservation`,
    );
    observation.bodyPreserved = (await semanticSnapshot(window.webContents)).bodyVisible;
    await prepare();
    await waitFor(
      window.webContents,
      `Boolean([...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === ${JSON.stringify(retryLabel)}))`,
      `${kind} failure after primary result verification`,
    );
  }
  blocked.delete(routeFragment);
  if (!await clickButtonByText(window.webContents, retryLabel)) {
    throw new Error(`${kind}: retry action disappeared`);
  }
  await waitFor(
    window.webContents,
    recoveredExpression || `![...document.querySelectorAll('button')].some((item) => (item.textContent || '').trim() === ${JSON.stringify(retryLabel)})`,
    `${kind} recovery`,
  );
  return { ...observation, actionable: true, recovered: true };
}

async function contextFailureTrace(window, blocked, outputDir, canonicalUrl) {
  const routeFragment = '/api/result-studio/context-envelope';
  blocked.add(routeFragment);
  await window.webContents.reload();
  await waitFor(
    window.webContents,
    `document.querySelector('[aria-label="用 Agent 修改当前结果"]')?.getAttribute('data-state') === 'blocked'`,
    'context fail-closed projection',
  );
  await waitFor(
    window.webContents,
    `Boolean(document.querySelector('[aria-label="结果主画布"] [class*="resultSidebarPreviewBody"] > *'))`,
    'context failure preserved body',
  );
  const observation = await captureFailureScreenshot(window, outputDir, 'context');
  blocked.delete(routeFragment);
  const recoveryStatus = await window.webContents.executeJavaScript(`
    (() => {
      const locationUrl = new URL(location.href);
      const projectId = locationUrl.pathname.split('/').filter(Boolean).at(-1);
      const jobId = locationUrl.searchParams.get('job');
      const artifact = locationUrl.searchParams.get('artifact');
      const query = new URLSearchParams({ projectId: projectId || '', jobId: jobId || '', artifact: artifact || '' });
      return fetch('http://localhost:3001/api/result-studio/context-envelope?' + query.toString())
        .then((response) => response.status)
        .catch(() => 0);
    })()
  `, true);
  if (!Number.isInteger(recoveryStatus) || recoveryStatus <= 0) {
    throw new Error('context endpoint remained unreachable after removing the injected failure');
  }
  await window.loadURL(canonicalUrl);
  await waitFor(
    window.webContents,
    `Boolean(document.querySelector('[aria-label="结果主画布"]'))`,
    'context recovery result canvas',
  );
  await waitFor(
    window.webContents,
    `document.querySelector('[aria-label="用 Agent 修改当前结果"]')?.getAttribute('data-state') === 'ready'`,
    'context recovery Agent binding',
  );
  const recoveredSnapshot = await semanticSnapshot(window.webContents);
  return {
    ...observation,
    actionable: true,
    failClosed: true,
    recovered: true,
    recoveryStatusClass: recoveryStatus < 500 ? 'reachable_bounded_response' : 'server_error',
    recoveredComposerState: recoveredSnapshot.composerState,
  };
}

// 首启引导浮层关闭（与 g0-rs-p6-recovery-electron-driver 同法）：
// fresh userData 下 DesktopOnboarding 必现，点「跳过引导」写入完成标记。
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

async function run() {
  const config = readConfig();
  mkdirSync(config.outputDir, { recursive: true });
  const checkpoint = (stage) => {
    driverLastStage = stage;
    writeFileSync(config.resultPath, `${JSON.stringify({ schemaVersion: 1, passed: false, stage })}\n`);
  };
  checkpoint('starting');

  const blocked = new Set();
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const matched = [...blocked].some((fragment) => details.url.includes(fragment));
    callback({ cancel: matched });
  });

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await window.loadURL(config.url);
  checkpoint('page_loaded');
  await waitFor(
    window.webContents,
    `Boolean(document.querySelector('[aria-label="结果主画布"]'))`,
    'Result Studio canvas',
  );
  // 首启引导浮层（fresh userData 必现）：必须在画布等待**之后**关——React 挂载
  // 引导晚于 loadURL 返回，过早探测会误判「无引导」。不关掉会盖住工作区、污染
  // 矩阵截图并拦截语义点击。与 P6 recovery 驱动同法：点「跳过引导」落完成标记。
  await dismissOnboarding(window.webContents);
  await waitFor(
    window.webContents,
    `Boolean(document.querySelector('[aria-label="结果主画布"] img, [aria-label="结果主画布"] table, [aria-label="结果主画布"] iframe, [aria-label="结果主画布"] pre, [aria-label="结果主画布"] [role="img"]'))`,
    'visible result body',
  );
  await waitFor(
    window.webContents,
    `document.querySelector('[aria-label="用 Agent 修改当前结果"]')?.getAttribute('data-state') === 'ready'`,
    'initial Agent context',
  );
  const initialResult = await semanticSnapshot(window.webContents);
  checkpoint('initial_result_visible');

  const openResult = await reopenResultTrace(window, config.requestedOutcome);
  checkpoint('result_reopened');
  await waitFor(
    window.webContents,
    `Boolean(document.querySelector('[aria-label="结果主画布"] [class*="resultSidebarPreviewBody"] > *'))`,
    'reopened visible result body',
  );

  const matrix = [];
  for (const theme of ['light', 'dark']) {
    for (const width of [1440, 1024, 820]) {
      matrix.push(await captureState(window, config.outputDir, `${theme}-${width}`, theme, width, 900));
    }
  }
  checkpoint('matrix_captured');

  const modeTrace = [];
  for (const [mode, label] of [
    ['code', '代码'],
    ['compare', ['审查', '审查修改']],
    ['history', ['历史', '版本历史']],
    ['result', '结果'],
  ]) {
    const startedAt = performance.now();
    await clickMode(window.webContents, label);
    await waitFor(
      window.webContents,
      `document.querySelector('[aria-label="结果主画布"]')?.getAttribute('data-mode') === ${JSON.stringify(mode)}`,
      `mode ${mode}`,
    );
    const snapshot = await semanticSnapshot(window.webContents);
    modeTrace.push({
      mode,
      feedbackMs: Number((performance.now() - startedAt).toFixed(3)),
      domSha256: digest(JSON.stringify(snapshot)),
      ...snapshot,
    });
  }

  const keyboard = await keyboardTrace(window);
  checkpoint('keyboard_captured');

  await clickMode(window.webContents, '结果');
  const lifecycle = await candidateLifecycleTrace(window);
  checkpoint('candidate_lifecycle_captured');
  const serviceRestart = await serviceRestartTrace(window, config.url);
  checkpoint('service_restart_captured');

  const failures = [];
  const interactionQuiet = await interactionQuietDegradationTrace(window, blocked, config.outputDir);
  failures.push(await retryableFailureTrace(window, blocked, config.outputDir, {
    kind: 'versions',
    routeFragment: '/api/result-studio/changesets?',
    retryLabel: '重试版本',
  }));
  failures.push(await retryableFailureTrace(window, blocked, config.outputDir, {
    kind: 'storage',
    routeFragment: '/api/result-studio/workspace/status',
    retryLabel: '重试存储状态',
  }));
  failures.push(await retryableFailureTrace(window, blocked, config.outputDir, {
    kind: 'code',
    routeFragment: '/api/result-studio/revisions/',
    retryLabel: '重试',
    prepare: async () => {
      await clickMode(window.webContents, '代码');
    },
    verifyPrimaryBody: true,
    recoveredExpression: `Boolean(document.querySelector('[aria-label="代码操作"]'))`,
  }));
  await clickMode(window.webContents, '结果');
  failures.push(await contextFailureTrace(window, blocked, config.outputDir, config.url));
  checkpoint('failure_matrix_captured');

  const screenshotHashes = matrix.map((item) => item.screenshotSha256);
  const result = {
    schemaVersion: 1,
    renderer: `Electron ${process.versions.electron} / Chromium ${process.versions.chrome}`,
    initialResult,
    openResult,
    matrix,
    modeTrace,
    keyboard,
    lifecycle,
    serviceRestart,
    failures,
    allMatrixStatesCaptured: matrix.length === 6,
    allScreenshotsDistinct: new Set(screenshotHashes).size === screenshotHashes.length,
    noHorizontalOverflow: matrix.every((item) => !item.pageHorizontalOverflow),
    bodyVisibleEverywhere: matrix.every((item) => item.bodyVisible),
    composerReadyEverywhere: initialResult.composerState === 'ready'
      && openResult.composerState === 'ready'
      && matrix.every((item) => item.composerState === 'ready'),
    noSensitiveProjection: [initialResult, openResult, ...matrix, ...modeTrace, ...failures, interactionQuiet]
      .every((item) => Object.values(item.internalLeakFlags || {}).every((flag) => !flag)),
    primaryActionBudgetMet: [...matrix, ...modeTrace].every((item) => item.visiblePrimaryActionCount <= 3),
    secondaryFailureRecoveryPassed: failures.length === 4
      && failures.every((item) => item.bodyPreserved
        && item.actionable
        && item.recovered
        && item.degradationVisible
        && !item.pageHorizontalOverflow)
      && interactionQuiet.quietByContract
      && interactionQuiet.imagePreserved
      && interactionQuiet.recovered
      && !interactionQuiet.pageHorizontalOverflow,
    continuousLifecyclePassed: openResult.draftPreserved
      && lifecycle.compareVisible
      && lifecycle.adopted
      && lifecycle.undone
      && lifecycle.restoredOrdinal === 3
      && lifecycle.replayConfirmed
      && lifecycle.replayCandidateDiscarded,
    serviceRestartPassed: Object.entries(serviceRestart)
      .filter(([key]) => !key.endsWith('Digest'))
      .every(([, value]) => value === true),
    visibleFeedbackBudget: {
      targetMs: 100,
      observedModeSwitchMaxMs: Math.max(...modeTrace.map((item) => item.feedbackMs)),
      modeSwitchPassed: modeTrace.every((item) => item.feedbackMs <= 100),
      openResultFeedbackMs: openResult.feedbackMs,
      openResultFeedbackPassed: openResult.feedbackMs <= 100,
      firstContentVisibleMs: openResult.firstContentVisibleMs,
      firstContentPassed: Number.isFinite(openResult.firstContentVisibleMs)
        ? openResult.firstContentVisibleMs <= 1_000
        : false,
    },
  };
  result.passed = result.allMatrixStatesCaptured
    && result.allScreenshotsDistinct
    && result.noHorizontalOverflow
    && result.bodyVisibleEverywhere
    && result.composerReadyEverywhere
    && result.noSensitiveProjection
    && result.primaryActionBudgetMet
    && result.secondaryFailureRecoveryPassed
    && result.continuousLifecyclePassed
    && result.serviceRestartPassed
    && keyboard.allFocusable
    && result.visibleFeedbackBudget.modeSwitchPassed
    && result.visibleFeedbackBudget.openResultFeedbackPassed
    && result.visibleFeedbackBudget.firstContentPassed;
  writeFileSync(config.resultPath, `${JSON.stringify(result, null, 2)}\n`);
  window.destroy();
}

app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error) => {
    try {
      const config = readConfig();
      writeFileSync(config.resultPath, `${JSON.stringify({
        schemaVersion: 1,
        passed: false,
        stage: driverLastStage,
        error: error && error.message ? error.message : String(error),
      }, null, 2)}\n`);
    } catch {
      // Parent receives the non-zero exit even if the disposable result cannot be written.
    }
    console.error(error && error.stack ? error.stack : error);
    app.exit(1);
  });
