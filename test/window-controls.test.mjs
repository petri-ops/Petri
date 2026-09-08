import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRELOAD_SOURCE = readFileSync(path.join(ROOT, 'src/preload.js'), 'utf8');
const WINDOW_CREATE_SOURCE = readFileSync(path.join(ROOT, 'src/main/_window-create.js'), 'utf8');
const WINDOW_IPC_SOURCE = readFileSync(path.join(ROOT, 'src/main/_window-ipc.js'), 'utf8');

/**
 * Extract just the function body (no signature) from source.
 * Handles destructured params `function name({ a, b }) {`.
 * Returns the body from the opening { to the matching closing }.
 */
function extractBody(source, afterSignature) {
  // afterSignature = index right after the closing `)` of the params
  let open = source.indexOf('{', afterSignature);
  assert.ok(open >= 0, 'expected function to have a body');
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  let escaped = false;

  for (let index = open; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (current === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (current === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (current === '\\') {
        escaped = true;
      } else if (current === quote) {
        quote = null;
      }
      continue;
    }
    if (current === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (current === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (current === '"' || current === "'" || current === '`') {
      quote = current;
      continue;
    }
    if (current === '{') depth += 1;
    if (current === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }

  assert.fail('unterminated function body');
}

/**
 * Extract a named function from source.
 * Returns the FULL function: from the `function` keyword to the closing `}`.
 * Handles destructured params like `function name({ a, b }) {`.
 */
function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `expected source to contain ${signature}`);
  // Find the opening `(` of the params in the source (not inside the signature string)
  const parenOpen = source.indexOf('(', start);
  assert.ok(parenOpen >= 0, `expected ${signature} to have parameters`);
  // Skip to after the matching `)` of the params
  let depth = 0;
  let i = parenOpen;
  let inString = false;
  let stringChar = null;
  let escaped = false;
  while (i < source.length) {
    const c = source[i];
    if (escaped) { escaped = false; i++; continue; }
    if (c === '\\') { escaped = true; i++; continue; }
    if (inString) {
      if (c === stringChar) inString = false;
      i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { inString = true; stringChar = c; i++; continue; }
    if (c === '{' || c === '(' || c === '[') { depth++; i++; continue; }
    if (c === '}' || c === ')' || c === ']') {
      depth--;
      if (depth === 0 && c === ')') {
        // Found closing `)` of params - the body starts at the next {
        const bodyStart = source.indexOf('{', i + 1);
        assert.ok(bodyStart >= 0, `expected ${signature} to have a body`);
        const body = extractBody(source, i + 1);
        // Return from `function` to end of body
        return source.slice(start, i + 1) + ' ' + body;
      }
      i++; continue;
    }
    i++;
  }
  assert.fail(`could not find body for ${signature}`);
}

function extractArrow(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `expected source to contain ${marker}`);
  const arrowStart = source.indexOf('(event, input) => {', start);
  assert.ok(arrowStart >= 0, `expected ${marker} to register an event callback`);
  const open = source.indexOf('{', arrowStart);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const current = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (current === '\\') escaped = true;
      else if (current === quote) quote = null;
      continue;
    }
    if (current === '"' || current === "'" || current === '`') {
      quote = current;
      continue;
    }
    if (current === '{') depth += 1;
    if (current === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(arrowStart, index + 1);
    }
  }
  assert.fail(`unterminated event callback for ${marker}`);
}

function createIpcMainHarness() {
  // All state lives inside the VM so ipcMain closures capture the right objects.
  const result = vm.runInNewContext(
    `
    (() => {
      const registrations = { on: [], handle: [] };
      const ipcMain = {
        on(channel, listener) { registrations.on.push({ channel, listener }); },
        handle(channel, listener) { registrations.handle.push({ channel, listener }); },
      };
      const process = { platform: 'darwin' };
      const app = {};
      let mainWindow = null;
      const getMainWindow = () => mainWindow;
      ${extractFunction(WINDOW_IPC_SOURCE, 'function setupWindowIpc({ ipcMain, process, app, getMainWindow }) {')}
      setupWindowIpc({ ipcMain, process, app, getMainWindow });
      return {
        registrations,
        setMainWindow(value) { mainWindow = value; },
      };
    })()
    `,
    {},
  );
  // Unwrap Proxy-wrapped arrays so assert.deepStrictEqual works correctly
  const regs = result.registrations;
  const unwrapped = {
    on: Array.from(regs.on),
    handle: Array.from(regs.handle),
  };
  return { registrations: unwrapped, setup: result };
}

function preloadHarness({ invokeValue } = {}) {
  const exposed = new Map();
  const sent = [];
  const invoked = [];
  const added = [];
  const removed = [];
  const listeners = new Map();

  const ipcRenderer = {
    send(channel, ...args) {
      sent.push({ channel, args });
    },
    invoke(channel, ...args) {
      invoked.push({ channel, args });
      return Promise.resolve(
        invokeValue === undefined ? { channel, args } : invokeValue,
      );
    },
    on(channel, listener) {
      added.push({ channel, listener });
      listeners.set(listener, { channel, listener });
    },
    removeListener(channel, listener) {
      removed.push({ channel, listener });
      listeners.delete(listener);
    },
  };

  const contextBridge = {
    exposeInMainWorld(name, value) {
      exposed.set(name, value);
    },
  };

  vm.runInNewContext(PRELOAD_SOURCE, {
    require(moduleName) {
      assert.equal(moduleName, 'electron');
      return { contextBridge, ipcRenderer };
    },
    process: { platform: 'darwin', arch: 'arm64', env: {} },
    window: { dispatchEvent() {} },
    CustomEvent: class CustomEvent {},
  });

  return { desktop: exposed.get('biof3Desktop'), sent, invoked, added, removed, listeners };
}

test('main window is explicitly frameless for renderer-owned controls', () => {
  // createWindow extracted to src/main/_window-create.js by SUB-15.1 PHASE 3
  const createWindowSource = extractFunction(WINDOW_CREATE_SOURCE, 'async function createWindow({');
  // Now contains the full function: signature + body
  const constructor = createWindowSource.match(
    /const mainWindow = new BrowserWindow\(\{[\s\S]*?\n\s*\}\);/,
  )?.[0];
  assert.ok(constructor, 'createWindow must construct the main BrowserWindow');
  assert.match(constructor, /\n\s*frame:\s*false,\n/);
});

test('window IPC registers exact controls and toggles maximize state', async () => {
  const { registrations, setup } = createIpcMainHarness();
  // window:toggleFullScreen was added after the original test expectation.
  // window:zoom-by / window:zoom-reset back the Ctrl/Cmd+wheel and keyboard zoom
  // (the frameless window has no menu bar, so the menu roles are unreachable).
  assert.deepEqual(registrations.on.map(({ channel }) => channel), [
    'window:minimize',
    'window:maximize',
    'window:close',
    'window:toggleFullScreen',
    'window:zoom-by',
    'window:zoom-reset',
  ]);
  assert.deepEqual(registrations.handle.map(({ channel }) => channel), ['window:isMaximized', 'window:isFullScreen', 'window:get-zoom', 'app:relaunch']);

  const calls = [];
  let maximized = false;
  const webContents = {};
  const mainWindow = {
    webContents,
    isDestroyed() { return false; },
    minimize() { calls.push('minimize'); },
    maximize() { calls.push('maximize'); },
    unmaximize() { calls.push('unmaximize'); },
    close() { calls.push('close'); },
    isMaximized() { return maximized; },
  };
  setup.setMainWindow(mainWindow);
  const event = { sender: webContents };

  const handler = (channel) => registrations.on.find((entry) => entry.channel === channel).listener;
  handler('window:minimize')(event);
  handler('window:maximize')(event);
  maximized = true;
  handler('window:maximize')(event);
  handler('window:close')(event);
  assert.deepEqual(calls, ['minimize', 'maximize', 'unmaximize', 'close']);

  const isMaximized = registrations.handle[0].listener;
  assert.equal(await isMaximized(event), true);

  const callsBeforeForeignSender = [...calls];
  const foreignEvent = { sender: {} };
  handler('window:minimize')(foreignEvent);
  handler('window:maximize')(foreignEvent);
  handler('window:close')(foreignEvent);
  handler('window:minimize')(undefined);
  assert.deepEqual(calls, callsBeforeForeignSender);
  assert.equal(await isMaximized(foreignEvent), false);

  setup.setMainWindow(null);
  assert.equal(await isMaximized(event), false);
});

test('maximize and unmaximize events send the precise renderer state channel', () => {
  // createWindow extracted to src/main/_window-create.js by SUB-15.1 PHASE 3
  const createWindowSource = extractFunction(WINDOW_CREATE_SOURCE, 'async function createWindow({');
  // Check for the publishMaximizedState block
  assert.ok(createWindowSource.includes('const publishMaximizedState'), 'must have publishMaximizedState');
  assert.ok(createWindowSource.includes('webContents.send('), 'must send via webContents');
  assert.ok(createWindowSource.includes('"window:maximize-changed"'), 'must use precise channel');
  assert.ok(createWindowSource.includes('.on("maximize"'), 'must listen to maximize event');
  assert.ok(createWindowSource.includes('.on("unmaximize"'), 'must listen to unmaximize event');
  // Count occurrences - should appear exactly once (in publishMaximizedState body)
  assert.equal((createWindowSource.match(/window:maximize-changed/g) || []).length, 1);
});

test('macOS window shortcuts close/minimize while preserving Cmd/Ctrl+R refresh semantics', () => {
  // createWindow extracted to src/main/_window-create.js by SUB-15.1 PHASE 3
  const createWindowSource = extractFunction(WINDOW_CREATE_SOURCE, 'async function createWindow({');
  const callbackSource = extractArrow(
    createWindowSource,
    'mainWindow.webContents.on("before-input-event"',
  );
  const calls = [];
  const testMainWindow = {
    webContents: {
      send(channel) { calls.push(channel); },
      reloadIgnoringCache() { calls.push('reloadIgnoringCache'); },
    },
    isDestroyed() { return false; },
    close() { calls.push('close'); },
    minimize() { calls.push('minimize'); },
  };
  // getMainWindow is used inside the before-input-event callback
  const getMainWindow = () => testMainWindow;
  const callback = vm.runInNewContext(`(${callbackSource})`, {
    mainWindow: testMainWindow,
    getMainWindow,
    process: { platform: 'darwin' },
    console: { log() {} },
  });
  let prevented = 0;
  const event = { preventDefault() { prevented += 1; } };

  callback(event, { key: 'W', meta: true });
  callback(event, { key: 'M', meta: true });
  callback(event, { key: 'R', meta: true });
  callback(event, { key: 'R', meta: true, shift: true });

  assert.equal(prevented, 4);
  assert.deepEqual(calls, ['close', 'minimize', 'app:soft-refresh', 'reloadIgnoringCache']);
});

test('preload window controls use exact IPC channels and cleanup the same listener', async () => {
  const { desktop, sent, invoked, added, removed, listeners } = preloadHarness();
  assert.ok(desktop?.window, 'preload must expose biof3Desktop.window');

  desktop.window.minimize();
  desktop.window.maximize();
  desktop.window.close();
  assert.equal(await desktop.window.isMaximized(), false);
  assert.deepEqual(sent, [
    { channel: 'window:minimize', args: [] },
    { channel: 'window:maximize', args: [] },
    { channel: 'window:close', args: [] },
  ]);
  assert.deepEqual(invoked, [{ channel: 'window:isMaximized', args: [] }]);

  const received = [];
  const cleanup = desktop.window.onMaximizeChanged((value) => received.push(value));
  const registration = added.find(({ channel }) => channel === 'window:maximize-changed');
  assert.ok(registration, 'onMaximizeChanged must subscribe to the maximize channel');
  assert.equal(listeners.has(registration.listener), true);
  registration.listener({ type: 'window:maximize-changed' }, true);
  registration.listener({ type: 'window:maximize-changed' }, 1);
  assert.deepEqual(received, [true, false]);

  assert.equal(typeof cleanup, 'function');
  cleanup();
  assert.deepEqual(removed, [{ channel: 'window:maximize-changed', listener: registration.listener }]);
  assert.equal(listeners.has(registration.listener), false);
});

test('preload projects only the literal true maximize query result and tolerates invalid callbacks', async () => {
  const { desktop, added } = preloadHarness({ invokeValue: 'truthy-but-not-boolean' });
  assert.equal(await desktop.window.isMaximized(), false);

  const cleanup = desktop.window.onMaximizeChanged(null);
  assert.equal(typeof cleanup, 'function');
  assert.equal(added.some(({ channel }) => channel === 'window:maximize-changed'), false);
  cleanup();
});

test('page zoom helpers clamp to the supported zoomLevel range and skip dead windows', () => {
  const { zoomBy, zoomReset, ZOOM_MIN, ZOOM_MAX } = require('../src/main/_zoom.js');

  let level = 0;
  const win = {
    isDestroyed: () => false,
    webContents: {
      getZoomLevel: () => level,
      setZoomLevel(next) { level = next; },
    },
  };

  assert.equal(zoomBy(win, 1), 1, 'one step in');
  assert.equal(zoomBy(win, 0.5), 1.5, 'fractional steps (wheel zoom) are supported');
  assert.equal(zoomBy(win, -10), ZOOM_MIN, 'zoom out clamps at ZOOM_MIN');
  assert.equal(zoomBy(win, 100), ZOOM_MAX, 'zoom in clamps at ZOOM_MAX');
  assert.equal(zoomReset(win), 0, 'reset returns to 100%');

  const dead = {
    isDestroyed: () => true,
    webContents: {
      getZoomLevel: () => 0,
      setZoomLevel() { throw new Error('must not touch a destroyed window'); },
    },
  };
  assert.equal(zoomBy(dead, 1), null);
  assert.equal(zoomReset(dead), null);
});

test('keyboard accelerator zooms on Ctrl/Cmd +/-/0 and leaves other shortcuts intact', () => {
  const createWindowSource = extractFunction(WINDOW_CREATE_SOURCE, 'async function createWindow({');
  const callbackSource = extractArrow(
    createWindowSource,
    'mainWindow.webContents.on("before-input-event"',
  );

  const calls = [];
  const testMainWindow = {
    webContents: {
      send(channel) { calls.push(channel); },
      reloadIgnoringCache() { calls.push('reloadIgnoringCache'); },
    },
    isDestroyed() { return false; },
    close() { calls.push('close'); },
    minimize() { calls.push('minimize'); },
  };
  const getMainWindow = () => testMainWindow;
  // zoomBy / zoomReset come from src/main/_zoom.js via a module-scope require,
  // so the extracted callback needs them injected.
  const zoomBy = (_win, delta) => { calls.push(`zoom:${delta}`); };
  const zoomReset = () => { calls.push('zoom:reset'); };

  const callback = vm.runInNewContext(`(${callbackSource})`, {
    mainWindow: testMainWindow,
    getMainWindow,
    process: { platform: 'win32' },
    console: { log() {} },
    zoomBy,
    zoomReset,
  });

  let prevented = 0;
  const event = { preventDefault() { prevented += 1; } };

  callback(event, { key: '=', control: true });
  callback(event, { key: '+', control: true, shift: true });
  callback(event, { key: '-', control: true });
  callback(event, { key: '0', control: true });
  callback(event, { key: '=', meta: true }); // macOS Cmd+= zooms too

  assert.deepEqual(
    calls,
    ['zoom:1', 'zoom:1', 'zoom:-1', 'zoom:reset', 'zoom:1'],
    'zoom keys must drive the zoom helpers',
  );
  assert.equal(prevented, 5, 'each zoom key must be prevented from reaching the page');

  // Non-zoom shortcuts must be untouched.
  calls.length = 0;
  callback(event, { key: 'r', control: true });
  assert.deepEqual(calls, ['app:soft-refresh'], 'Ctrl/Cmd+R still triggers soft refresh');
});
