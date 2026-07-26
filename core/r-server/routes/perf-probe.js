/**
 * Performance probe endpoints for G0-RS-P4R baseline capture.
 *
 * Only mounted when BIOF3_PERF_PROBE=1, so the surface does not exist in a
 * normal desktop run. The snapshot carries timing statistics and route
 * templates only — never result content, real paths, ids or credentials.
 */

const perfProbe = require('../helpers/perf-probe');

module.exports = function registerPerfProbeRoutes(app) {
  if (!perfProbe.envEnabled()) return;
  perfProbe.enableProbe();

  app.get('/api/__perf/event-loop', (_req, res) => {
    res.json(perfProbe.snapshotProbe());
  });

  app.post('/api/__perf/reset', (_req, res) => {
    res.json({ reset: perfProbe.resetProbe(), enabled: perfProbe.isProbeActive() });
  });
};
