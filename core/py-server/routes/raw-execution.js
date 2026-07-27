const { requireTrustedDesktopOrigin } = require('../../shared-backend/local-request-boundary');

function registerPythonRawExecution(app) {
  app.post('/api/run', requireTrustedDesktopOrigin, (_req, res) => {
    return res.status(410).json({
      status: 'error',
      error: 'raw_python_execution_disabled',
      message: '任意 Python 代码执行入口已停用；正式分析必须通过已注册工具和 tool_job 执行。',
    });
  });
}

module.exports = { registerPythonRawExecution };
