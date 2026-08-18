// CommonJS helper used by test/chat-file-references.test.mjs to load the
// /api/harness/file-references/resolve route with a stubbed db module.
// After PHASE 2.2a (harness 8-subdomain split), also clears the harness/
// subdirectory from require.cache so that subdomains re-resolve their db
// reference through the patched _resolveFilename hook.
const path = require('path');
const fs = require('fs');
const Module = require('module');

function clearHarnessCache(rServer) {
  const harnessDir = path.join(rServer, 'routes', 'harness');
  const patterns = [
    path.join(rServer, 'routes', 'harness.js'),
    path.join(harnessDir, 'index.js'),
    path.join(harnessDir, 'resources.js'),
    path.join(harnessDir, 'workflow.js'),
    path.join(harnessDir, 'repair.js'),
    path.join(harnessDir, 'scientific-task.js'),
    path.join(harnessDir, 'context.js'),
    path.join(harnessDir, 'file-references.js'),
    path.join(harnessDir, 'loop.js'),
    path.join(rServer, 'routes', '_helpers', 'harness-shared.js'),
    path.join(rServer, 'routes', '_helpers', 'workspace-file-index.js'),
    path.join(rServer, 'db.js'),
  ];
  for (const p of patterns) {
    if (fs.existsSync(p)) delete require.cache[p];
  }
  if (fs.existsSync(harnessDir)) {
    for (const entry of fs.readdirSync(harnessDir)) {
      const full = path.join(harnessDir, entry);
      if (entry.endsWith('.js') && fs.statSync(full).isFile()) {
        delete require.cache[full];
      }
    }
  }
}

function loadResolveRoute(dbStub) {
  const rServer = path.resolve(__dirname, '..', 'core', 'r-server');
  const harnessModulePath = path.join(rServer, 'routes', 'harness.js');
  const dbModulePath = path.join(rServer, 'db.js');

  clearHarnessCache(rServer);

  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function patchedResolve(request, isMain, options) {
    if (/\/db$/.test(request)) return dbModulePath;
    return originalResolve(request, isMain, options);
  };

  const handlers = {};
  const app = {
    post(p, ...args) {
      let handler = args[args.length - 1];
      if (args.length === 1 && typeof args[0] === 'function') handler = args[0];
      if (typeof handler === 'function') handlers['POST ' + p] = handler;
    },
    get(p, ...args) {
      let handler = args[args.length - 1];
      if (args.length === 1 && typeof args[0] === 'function') handler = args[0];
      if (typeof handler === 'function') handlers['GET ' + p] = handler;
    },
  };

  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: dbStub,
  };

  try {
    require(harnessModulePath)(app);
  } finally {
    Module._resolveFilename = originalResolve;
  }

  return function invoke(body, opts) {
    opts = opts || {};
    const handler = handlers['POST /api/harness/file-references/resolve'];
    if (!handler) throw new Error('route not registered');
    let status = 200;
    let payload = null;
    const req = {
      user: { id: opts.userId || 'u_local' },
      isInternal: !!opts.isInternal,
      body,
      query: {},
    };
    const res = {
      status(code) {
        status = code;
        return this;
      },
      json(obj) {
        payload = obj;
        return this;
      },
    };
    return handler(req, res).then(() => ({ status, body: payload }));
  };
}

module.exports = { loadResolveRoute };
