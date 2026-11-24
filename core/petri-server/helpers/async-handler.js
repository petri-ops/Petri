'use strict';

/**
 * BLOCK-511 S3.4 — Express 4 async 路由抛错兜底。
 * asyncHandler 把 async handler 的 rejection 转交 next(err)；installErrorMiddleware
 * 挂全局错误中间件，返回项目既有错误形状 { status:'error', error, message } 的 5xx JSON。
 */
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    try {
      return Promise.resolve(fn(req, res, next)).catch(next);
    } catch (error) {
      next(error);
      return undefined;
    }
  };
}

function installErrorMiddleware(app) {
  app.use((err, _req, res, _next) => {
    if (res.headersSent) return;
    const status = Number(err && err.status) >= 500 && Number(err.status) < 600 ? Number(err.status) : 500;
    res.status(status).json({
      status: 'error',
      error: 'internal_error',
      message: String((err && err.message) || 'Internal server error'),
    });
  });
}

module.exports = { asyncHandler, installErrorMiddleware };
