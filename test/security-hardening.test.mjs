/**
 * SEC-HARDEN — 主进程安全加固契约测试（AUDIT-LOG 代码复审余项 ③ 附带安全专项）
 *
 * 覆盖三处缺口（均对齐 Electron 官方安全清单）：
 *   #5  未设 setPermissionRequestHandler → 官方默认「自动批准一切权限请求」；
 *   #11 `<webview allowpopups>`；
 *   #12 未校验 `<webview>` 的 webPreferences/params。
 * 断言策略与装配两条线都测：纯决策函数逐条边界 + 装配函数在假 app/session 上的真实调用。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  WEBVIEW_PARTITION_ALLOWLIST,
  TRUSTED_RENDERER_PERMISSIONS,
  applyPermissionPolicy,
  applyWebContentsHardening,
  decidePermission,
  isHttpOrHttps,
  safeOrigin,
  trustedOriginsFromEnv,
  verifyWebviewAttach,
} from '../src/main/security-hardening.js';

const TRUSTED = 'http://localhost:3000';

// ── #12 webview 附着校验 ─────────────────────────────────────────

test('webview 附着：中和 preload 与全部不安全偏好，合法 src/partition 放行', () => {
  const webPreferences = {
    preload: '/tmp/evil-preload.js',
    preloadURL: 'file:///tmp/evil-preload.js',
    nodeIntegration: true,
    nodeIntegrationInSubFrames: true,
    contextIsolation: false,
    sandbox: false,
    webSecurity: false,
    allowRunningInsecureContent: true,
  };
  const verdict = verifyWebviewAttach({
    webPreferences,
    params: { src: 'https://example.com/doc', partition: 'persist:petri-browser' },
  });

  assert.equal(verdict.allow, true);
  assert.equal(verdict.reason, 'hardened');
  assert.equal('preload' in webPreferences, false, 'preload 必须被删除');
  assert.equal('preloadURL' in webPreferences, false, 'preloadURL 必须被删除');
  assert.equal(webPreferences.nodeIntegration, false);
  assert.equal(webPreferences.nodeIntegrationInSubFrames, false);
  assert.equal(webPreferences.contextIsolation, true);
  assert.equal(webPreferences.sandbox, true);
  assert.equal(webPreferences.webSecurity, true);
  assert.equal(webPreferences.allowRunningInsecureContent, false);
  assert.deepEqual(
    verdict.mutations.sort(),
    [
      'forced_allow_running_insecure_content_false',
      'forced_context_isolation_true',
      'forced_node_integration_false',
      'forced_node_integration_subframes_false',
      'forced_sandbox_true',
      'forced_web_security_true',
      'stripped_preload',
      'stripped_preload_url',
    ].sort(),
  );
});

test('webview 附着：partition 不在白名单一律拒绝（仍先中和偏好）', () => {
  const webPreferences = { nodeIntegration: true };
  const verdict = verifyWebviewAttach({
    webPreferences,
    params: { src: 'https://example.com/', partition: 'persist:attacker' },
  });

  assert.equal(verdict.allow, false);
  assert.equal(verdict.reason, 'partition_not_allowlisted');
  assert.equal(webPreferences.nodeIntegration, false, '拒绝前也必须中和');
  assert.deepEqual(WEBVIEW_PARTITION_ALLOWLIST, ['persist:petri-browser']);
});

test('webview 附着：非 http(s) 的 src 一律拒绝（file/javascript/data/about）', () => {
  for (const src of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,<b>x</b>', 'about:blank', '', 'https://']) {
    const verdict = verifyWebviewAttach({
      webPreferences: {},
      params: { src, partition: 'persist:petri-browser' },
    });
    assert.equal(verdict.allow, false, `应拒绝 src=${JSON.stringify(src)}`);
    assert.equal(verdict.reason, 'src_not_http_or_https');
  }
});

test('webview 附着：无 partition（默认 session）放行——只校验协议，不强制声明分区', () => {
  const verdict = verifyWebviewAttach({ webPreferences: {}, params: { src: 'http://127.0.0.1:3001/api/health' } });
  assert.equal(verdict.allow, true);
});

test('isHttpOrHttps / safeOrigin 边界', () => {
  assert.equal(isHttpOrHttps('https://example.com/a?b=c'), true);
  assert.equal(isHttpOrHttps('http://localhost:3000'), true);
  assert.equal(isHttpOrHttps('ftp://example.com'), false);
  assert.equal(isHttpOrHttps('not a url'), false);
  assert.equal(safeOrigin('https://example.com/path'), 'https://example.com');
  assert.equal(safeOrigin('garbage'), '');
  assert.equal(safeOrigin(''), '');
});

// ── #5 权限策略 ──────────────────────────────────────────────────

test('权限决策：仅受信 origin 且属于白名单权限才放行', () => {
  const trustedOrigins = [TRUSTED];

  assert.equal(decidePermission({ permission: 'clipboard-sanitized-write', origin: TRUSTED, trustedOrigins }), true);
  assert.equal(decidePermission({ permission: 'openExternal', origin: TRUSTED, trustedOrigins }), true);
  assert.equal(decidePermission({ permission: 'media', origin: TRUSTED, trustedOrigins }), false);
  assert.equal(decidePermission({ permission: 'geolocation', origin: TRUSTED, trustedOrigins }), false);
  assert.equal(decidePermission({ permission: 'display-capture', origin: TRUSTED, trustedOrigins }), false);
  assert.equal(decidePermission({ permission: 'notifications', origin: TRUSTED, trustedOrigins }), false);
  assert.equal(decidePermission({ permission: 'clipboard-read', origin: TRUSTED, trustedOrigins }), false);
  assert.equal(decidePermission({ permission: 'usb', origin: TRUSTED, trustedOrigins }), false);
  assert.equal(decidePermission({ permission: 'unknown', origin: TRUSTED, trustedOrigins }), false);
  assert.equal(decidePermission({ permission: undefined, origin: TRUSTED, trustedOrigins }), false);
  assert.equal(decidePermission({ permission: 'clipboard-sanitized-write', origin: 'https://evil.example', trustedOrigins }), false);
  assert.equal(decidePermission({ permission: 'clipboard-sanitized-write', origin: '', trustedOrigins }), false);
  assert.equal(decidePermission({ permission: 'clipboard-sanitized-write', origin: TRUSTED, trustedOrigins: [] }), false);
});

test('权限决策：非同一 origin 一律拒绝（不允许 startsWith 式比较）', () => {
  const trustedOrigins = [TRUSTED];
  for (const origin of [
    'http://localhost:3000.evil.example',
    'http://localhost:30001',
    'https://localhost:3000',
    'http://127.0.0.1:3000',
    'https://evil.example',
    'null',
  ]) {
    assert.equal(
      decidePermission({ permission: 'clipboard-sanitized-write', origin, trustedOrigins }),
      false,
      `不得放行 ${origin}`,
    );
  }
  // URL 规范化语义：路径不参与同源判定——`/../evil` 仍属自家 origin，放行才是正确的
  assert.equal(safeOrigin('http://localhost:3000/../evil'), TRUSTED);
  assert.equal(
    decidePermission({ permission: 'clipboard-sanitized-write', origin: 'http://localhost:3000/../evil', trustedOrigins }),
    true,
  );
  // 末尾斜杠/默认端口同源等价（http 默认 80 端口会从 origin 里消失）
  assert.equal(safeOrigin('http://localhost:3000/'), TRUSTED);
  assert.equal(decidePermission({ permission: 'openExternal', origin: 'http://localhost:3000/?a=b#c', trustedOrigins }), true);
});

test('trustedOriginsFromEnv：逗号分隔 + 去空白 + 剔除空项', () => {
  assert.deepEqual(
    trustedOriginsFromEnv({ PETRI_TRUSTED_DESKTOP_ORIGINS: ' http://localhost:3000 , http://127.0.0.1:3000 ,, ' }),
    ['http://localhost:3000', 'http://127.0.0.1:3000'],
  );
  assert.deepEqual(trustedOriginsFromEnv({}), []);
  assert.deepEqual(trustedOriginsFromEnv({ PETRI_TRUSTED_DESKTOP_ORIGINS: '' }), []);
});

test('applyPermissionPolicy：默认 session 装齐两个 handler，且决策与纯函数一致', () => {
  const handlers = {};
  const session = {
    defaultSession: {
      setPermissionRequestHandler: (fn) => { handlers.request = fn; },
      setPermissionCheckHandler: (fn) => { handlers.check = fn; },
    },
  };
  const warn = () => {};
  const { trustedOrigins } = applyPermissionPolicy({
    session,
    env: { PETRI_TRUSTED_DESKTOP_ORIGINS: TRUSTED },
    log: { warn },
  });

  assert.deepEqual(trustedOrigins, [TRUSTED]);
  assert.equal(typeof handlers.request, 'function', 'request handler 必须装配');
  assert.equal(typeof handlers.check, 'function', 'check handler 必须装配（只装一个会漏）');

  const decisions = [];
  handlers.request({ getURL: () => `${TRUSTED}/project/x` }, 'clipboard-sanitized-write', (ok) => decisions.push(ok));
  handlers.request({ getURL: () => 'https://evil.example/' }, 'clipboard-sanitized-write', (ok) => decisions.push(ok));
  handlers.request({ getURL: () => `${TRUSTED}/` }, 'media', (ok) => decisions.push(ok));
  decisions.push(handlers.check({ getURL: () => `${TRUSTED}/` }, 'clipboard-sanitized-write', TRUSTED));
  decisions.push(handlers.check({ getURL: () => `${TRUSTED}/` }, 'media', TRUSTED));
  decisions.push(handlers.check({ getURL: () => 'https://evil.example/' }, 'clipboard-sanitized-write', 'https://evil.example'));
  assert.deepEqual(decisions, [true, false, false, true, false, false]);
});

test('applyPermissionPolicy：检查 handler 在 requestingOrigin 为空时回退 webContents.getURL() —— 实机缺陷回归', () => {
  // 实机现象：Chromium 对剪贴板写不一定带 requestingOrigin，只按它判会把自家 UI 的
  // 复制按钮误杀（`navigator.clipboard.writeText` → Write permission denied）。
  const handlers = {};
  const session = {
    defaultSession: {
      setPermissionRequestHandler: (fn) => { handlers.request = fn; },
      setPermissionCheckHandler: (fn) => { handlers.check = fn; },
    },
  };
  applyPermissionPolicy({ session, env: { PETRI_TRUSTED_DESKTOP_ORIGINS: TRUSTED }, log: { warn: () => {} } });

  assert.equal(handlers.check({ getURL: () => `${TRUSTED}/project/x` }, 'clipboard-sanitized-write', ''), true);
  assert.equal(handlers.check({ getURL: () => `${TRUSTED}/project/x` }, 'clipboard-sanitized-write', undefined), true);
  assert.equal(handlers.check(null, 'clipboard-sanitized-write', ''), false, '两者都取不到 → 拒绝（安全侧失败）');
  assert.equal(handlers.check(null, 'clipboard-sanitized-write', TRUSTED), true);
  assert.equal(handlers.check({ getURL: () => 'http://127.0.0.1:3001/api/health' }, 'geolocation', ''), false);
});

test('applyPermissionPolicy：session-created 覆盖分区 session —— 实机缺陷回归（webview guest 曾走默认放行）', () => {
  // 实机现象：`<webview partition="persist:petri-browser">` 用的是分区 session，
  // 只装 defaultSession 时 guest 内 geolocation 查询仍为 granted。
  const app = new EventEmitter();
  const session = {
    defaultSession: {
      setPermissionRequestHandler: () => {},
      setPermissionCheckHandler: () => {},
    },
  };
  const result = applyPermissionPolicy({ session, app, env: { PETRI_TRUSTED_DESKTOP_ORIGINS: TRUSTED }, log: { warn: () => {} } });
  assert.equal(result.installedSessions.size, 1, '默认 session 已装');

  const partitionHandlers = {};
  const partitionSession = {
    setPermissionRequestHandler: (fn) => { partitionHandlers.request = fn; },
    setPermissionCheckHandler: (fn) => { partitionHandlers.check = fn; },
  };
  app.emit('session-created', partitionSession);

  assert.equal(typeof partitionHandlers.check, 'function', '新 session 必须被装上策略');
  assert.equal(partitionHandlers.check({ getURL: () => 'http://127.0.0.1:3001/api/health' }, 'geolocation', ''), false);
  assert.equal(partitionHandlers.check({ getURL: () => `${TRUSTED}/` }, 'clipboard-sanitized-write', ''), true);
  assert.equal(result.installedSessions.size, 2);

  // 幂等：同一 session 重复触发不重复安装
  app.emit('session-created', partitionSession);
  assert.equal(result.installedSessions.size, 2);
});

test('applyPermissionPolicy：受信 origin 为空时全拒（安全侧失败）并告警', () => {
  const handlers = {};
  const warnings = [];
  const session = {
    defaultSession: {
      setPermissionRequestHandler: (fn) => { handlers.request = fn; },
      setPermissionCheckHandler: (fn) => { handlers.check = fn; },
    },
  };
  applyPermissionPolicy({ session, env: {}, log: { warn: (msg) => warnings.push(String(msg)) } });

  let decision = null;
  handlers.request({ getURL: () => `${TRUSTED}/` }, 'clipboard-sanitized-write', (ok) => { decision = ok; });
  assert.equal(decision, false);
  assert.equal(handlers.check(null, 'clipboard-sanitized-write', TRUSTED), false);
  assert.ok(warnings.some((line) => line.includes('PETRI_TRUSTED_DESKTOP_ORIGINS 为空')), '应告警');
});

test('applyPermissionPolicy：缺少 session 模块时 fail-fast', () => {
  assert.throws(() => applyPermissionPolicy({ session: undefined }), /requires the Electron session module/);
});

// ── #11/#12 装配 ─────────────────────────────────────────────────

function makeFakeContents() {
  const contents = new EventEmitter();
  const windowOpenHandler = { value: null };
  contents.setWindowOpenHandler = (fn) => { windowOpenHandler.value = fn; };
  return { contents, windowOpenHandler };
}

test('applyWebContentsHardening：每个 webContents 都装 will-attach-webview 与 popup 守卫', () => {
  const app = new EventEmitter();
  const opened = [];
  const shell = { openExternal: (url) => { opened.push(url); return Promise.resolve(); } };
  const warnings = [];
  applyWebContentsHardening({ app, shell, log: { warn: (msg) => warnings.push(String(msg)) } });

  const { contents, windowOpenHandler } = makeFakeContents();
  app.emit('web-contents-created', {}, contents);

  assert.equal(typeof windowOpenHandler.value, 'function', 'popup 守卫必须装配');

  let prevented = false;
  const evilPrefs = { preload: '/tmp/evil.js', nodeIntegration: true, sandbox: false, contextIsolation: false };
  contents.emit('will-attach-webview', { preventDefault: () => { prevented = true; } }, evilPrefs, { src: 'https://example.com/', partition: 'persist:petri-browser' });
  assert.equal(prevented, false, '合法 partition + https src 应放行');
  assert.equal(evilPrefs.preload, undefined, 'preload 必须被删除');
  assert.equal(evilPrefs.nodeIntegration, false);

  contents.emit('will-attach-webview', { preventDefault: () => { prevented = true; } }, {}, { src: 'file:///etc/passwd' });
  assert.equal(prevented, true, 'file:// src 必须被拦下');
  assert.ok(warnings.some((line) => line.includes('拒绝 webview 附着')), '拒绝应留日志');
});

test('applyWebContentsHardening：popup 一律 deny；http(s) 交系统浏览器，非 http(s) 不转发', () => {
  const app = new EventEmitter();
  const opened = [];
  const shell = { openExternal: (url) => { opened.push(url); return Promise.resolve(); } };
  applyWebContentsHardening({ app, shell, log: { warn: () => {} } });

  const { contents, windowOpenHandler } = makeFakeContents();
  app.emit('web-contents-created', {}, contents);

  assert.deepEqual(windowOpenHandler.value({ url: 'https://example.com/doc' }), { action: 'deny' });
  assert.deepEqual(windowOpenHandler.value({ url: 'file:///etc/passwd' }), { action: 'deny' });
  assert.deepEqual(windowOpenHandler.value({ url: '' }), { action: 'deny' });
  assert.deepEqual(opened, ['https://example.com/doc'], '只有 http(s) 交系统浏览器');
});

test('applyWebContentsHardening：缺少 app 时 fail-fast', () => {
  assert.throws(() => applyWebContentsHardening({ app: null }), /requires the Electron app object/);
});

test('常量冻结：白名单不可被就地改写（防运行时被第三方代码污染）', () => {
  assert.equal(Object.isFrozen(WEBVIEW_PARTITION_ALLOWLIST), true);
  assert.equal(Object.isFrozen(TRUSTED_RENDERER_PERMISSIONS), true);
  assert.deepEqual([...TRUSTED_RENDERER_PERMISSIONS], ['clipboard-sanitized-write', 'openExternal']);
});
