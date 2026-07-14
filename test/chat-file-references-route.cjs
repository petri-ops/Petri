// CommonJS helper used by test/chat-file-references.test.mjs to load the
// /api/harness/file-references/resolve route with a stubbed db module.
const path = require('path');
const Module = require('module');

function loadResolveRoute(dbStub) {
  const rServer = path.resolve(__dirname, '..', 'vendor', 'biof3-core', 'r-server');
  const harnessModulePath = path.join(rServer, 'routes', 'harness.js');
  const dbModulePath = path.join(rServer, 'db.js');

  delete require.cache[harnessModulePath];
  delete require.cache[dbModulePath];
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function patchedResolve(request, parent, ...rest) {
    if (request === '../db' || request.endsWith('/db')) return dbModulePath;
    return originalResolve.call(this, request, parent, ...rest);
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
    delete require.cache[harnessModulePath];
    delete require.cache[dbModulePath];
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