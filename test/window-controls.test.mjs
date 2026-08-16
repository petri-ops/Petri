import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN_SOURCE = readFileSync(path.join(ROOT, 'src/main.js'), 'utf8');
const PRELOAD_SOURCE = readFileSync(path.join(ROOT, 'src/preload.js'), 'utf8');

/**
 * Extract one named function without evaluating the Electron main process.
 * The scanner ignores strings and comments so a brace in a diagnostic string
 * cannot make the contract section end early.
 */
function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `expected source to contain ${signature}`);
  // The signature includes the function's opening brace. Start at `start`
  // rather than after the signature, otherwise the first nested arrow/object
  // body would be mistaken for the function body.
  const open = source.indexOf('{', start);
  assert.ok(open >= 0, `expected ${signature} to have a body`);

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
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  assert.fail(`unterminated function body for ${signature}`);
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
  const registrations = { on: [], handle: [] };
  const ipcMain = {
    on(channel, listener) {
      registrations.on.push({ channel, listener });
    },
    handle(channel, listener) {
      registrations.handle.push({ channel, listener });
    },
  };
  // The extracted function closes over the ipcMain binding. Evaluate it in a
  // small vm context so importing the Electron main process is unnecessary.
  const setupWithIpc = vm.runInNewContext(`
    (() => {
      let mainWindow = null;
      const ipcMain = globalThis.ipcMain;
      ${extractFunction(MAIN_SOURCE, 'function setupWindowIpc() {')}
      return {
        setupWindowIpc,
        setMainWindow(value) { mainWindow = value; },
      };
    })()
  `, { ipcMain });
  setupWithIpc.setupWindowIpc();
  return { registrations, setup: setupWithIpc };
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
  const createWindowSource = extractFunction(MAIN_SOURCE, 'async function createWindow() {');
  const constructor = createWindowSource.match(
    /mainWindow = new BrowserWindow\(\{[\s\S]*?\n\s*\}\);/,
  )?.[0];
  assert.ok(constructor, 'createWindow must construct the main BrowserWindow');
  assert.match(constructor, /\n\s*frame:\s*false,\n/);
});

test('window IPC registers exact controls and toggles maximize state', async () => {
  const { registrations, setup } = createIpcMainHarness();
  assert.deepEqual(registrations.on.map(({ channel }) => channel), [
    'window:minimize',
    'window:maximize',
    'window:close',
  ]);
  assert.deepEqual(registrations.handle.map(({ channel }) => channel), ['window:isMaximized', 'app:relaunch']);

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
  const createWindowSource = extractFunction(MAIN_SOURCE, 'async function createWindow() {');
  const publishBlock = createWindowSource.match(
    /const publishMaximizedState = \(isMaximized\) => \{[\s\S]*?windowForEvents\.webContents\.send\(\s*"window:maximize-changed",\s*isMaximized,\s*\);\s*\};/,
  )?.[0];
  assert.ok(publishBlock, 'maximize state must be sent through the precise renderer channel');
  assert.match(createWindowSource, /windowForEvents\.on\("maximize", \(\) => publishMaximizedState\(true\)\);/);
  assert.match(createWindowSource, /windowForEvents\.on\("unmaximize", \(\) => publishMaximizedState\(false\)\);/);
  assert.equal((createWindowSource.match(/window:maximize-changed/g) || []).length, 1);
});

test('macOS window shortcuts close/minimize while preserving Cmd/Ctrl+R refresh semantics', () => {
  const createWindowSource = extractFunction(MAIN_SOURCE, 'async function createWindow() {');
  const callbackSource = extractArrow(
    createWindowSource,
    'mainWindow.webContents.on("before-input-event"',
  );
  const calls = [];
  const mainWindow = {
    webContents: {
      send(channel) { calls.push(channel); },
      reloadIgnoringCache() { calls.push('reloadIgnoringCache'); },
    },
    isDestroyed() { return false; },
    close() { calls.push('close'); },
    minimize() { calls.push('minimize'); },
  };
  const callback = vm.runInNewContext(`(${callbackSource})`, {
    mainWindow,
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
