const express = require('express');

function createToolsInternalRoutes({
  requireInternal,
  handleToolRun,
  handlePublicDemo,
  handlePublicFile,
  handleDemoData,
  handleLegacyDemoFile,
  handleLegacyDemoList,
  handlePrivateFileRead,
  handlePrivateFileWrite,
  handleGenerateFinalReport,
  killLocalToolJob,
  cleanupLocalToolJobDir,
  isSmokeTestRequest,
  notify,
}) {
  function registerToolsInternal(app) {
    app.post('/api/internal/tools/run', express.json({limit: '200mb'}), async (req, res) => {
      if (!requireInternal(req, res)) return;
      try {
        return await handleToolRun(req, res);
      } catch (e) {
        return res.status(500).json({error: e.message});
      }
    });

    app.get('/api/internal/tools/public-demo/:toolId', async (req, res) => {
      if (!requireInternal(req, res)) return;
      return handlePublicDemo(req, res);
    });

    app.get('/api/internal/tools/public-file/:jobId/:filename', async (req, res) => {
      if (!requireInternal(req, res)) return;
      return handlePublicFile(req, res);
    });

    app.get('/api/internal/tools/demo-data/:toolId/:filename', (req, res) => {
      if (!requireInternal(req, res)) return;
      return handleDemoData(req, res);
    });

    app.get('/api/internal/tools/demo/:toolId/:filename', (req, res) => {
      if (!requireInternal(req, res)) return;
      return handleLegacyDemoFile(req, res);
    });

    app.get('/api/internal/tools/demo/:toolId', (req, res) => {
      if (!requireInternal(req, res)) return;
      return handleLegacyDemoList(req, res);
    });

    app.get('/api/internal/tools/file/:jobId/:filename', (req, res) => {
      if (!requireInternal(req, res)) return;
      return handlePrivateFileRead(req, res);
    });

    app.put('/api/internal/tools/file/:jobId/:filename', express.raw({type: '*/*', limit: '10mb'}), (req, res) => {
      if (!requireInternal(req, res)) return;
      return handlePrivateFileWrite(req, res, req.headers['x-biof3-tool-id'] || '');
    });

    app.post('/api/internal/tools/report/:jobId', express.json({limit: '16kb'}), (req, res) => {
      if (!requireInternal(req, res)) return;
      return handleGenerateFinalReport(req, res);
    });

    app.post('/api/internal/tools/cancel/:id', express.json({limit: '16kb'}), (req, res) => {
      if (!requireInternal(req, res)) return;
      const local = killLocalToolJob(req.params.id);
      return res.json({ok: true, status: 'cancelled', local});
    });

    app.delete('/api/internal/tools/job/:id', express.json({limit: '16kb'}), (req, res) => {
      if (!requireInternal(req, res)) return;
      const local = cleanupLocalToolJobDir(req.params.id);
      return res.json({ok: true, local});
    });

    app.post('/api/internal/smoke-test-result', express.json({limit: '64kb'}), (req, res) => {
      if (!isSmokeTestRequest(req)) return res.status(403).json({error: 'forbidden'});
      const {ok, totalCount, passCount, failCount, durationMs, failures} = req.body || {};
      try {
        notify.smokeTest({
          ok: !!ok,
          totalCount: totalCount || 0,
          passCount: passCount || 0,
          failCount: failCount || 0,
          durationMs: durationMs || 0,
          failures: failures || [],
        });
      } catch (e) {
        console.warn('[tools] smoke-test notify error:', e.message);
      }
      res.json({ok: true});
    });
  }

  return registerToolsInternal;
}

module.exports = {
  createToolsInternalRoutes,
};
