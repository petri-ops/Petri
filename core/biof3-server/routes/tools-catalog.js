'use strict';

/**
 * Tool catalog projection (BLOCK-83 D4：目录提供者 SPI).
 *
 * The tool catalog is a *projection over installed plugins*, never a hard-coded
 * domain list in the core. With zero plugins installed the catalog is empty and
 * consumers must render an honest empty state — that is the "no domain pack
 * installed" product behaviour.
 *
 * Provider seam: the projection reads `plugin-loader.getAllPluginManifests()`
 * (the same source `mcp/registry.listTools()` uses), so any domain pack that can
 * register tools also appears here without core changes.
 */

const pluginLoader = require('../plugin-loader');

function _toCatalogEntry(manifest) {
  if (!manifest || !manifest.id) return null;
  return {
    id: manifest.id,
    title: manifest.title || manifest.id,
    subtitle: manifest.subtitle || '',
    description: manifest.description || '',
    category: manifest.category || 'analysis',
    language: manifest.language || null,
    type: manifest.type || null,
    version: manifest.version || null,
    inputs: Array.isArray(manifest.inputs) ? manifest.inputs : [],
    outputs: Array.isArray(manifest.outputs) ? manifest.outputs : [],
    artifacts: Array.isArray(manifest.artifacts) ? manifest.artifacts : [],
    estimatedMinutes: manifest.estimatedMinutes == null ? null : manifest.estimatedMinutes,
    packages: manifest.packages || {},
    runtime: manifest.runtime || {},
    builtAgainst: manifest.builtAgainst || {},
    supportedPlatforms: manifest.supportedPlatforms || manifest.platform || [],
    failureModes: Array.isArray(manifest.failureModes) ? manifest.failureModes : [],
    resultStudioAvailable: !!(manifest.resultStudioValidation && manifest.resultStudioValidation.valid),
    execution: manifest.execution || {},
    // 表现层（缺省由前端兜底）
    color: manifest.color || null,
    tutorialUrl: manifest.tutorialUrl || null,
    demoDataUrl: manifest.demoDataUrl || null,
    comingSoon: manifest.comingSoon === true,
  };
}

function createToolsCatalogRoutes() {
  return function registerToolsCatalog(app) {
    app.get('/api/tools/catalog', async (req, res) => {
      try {
        const manifests = pluginLoader.ensurePluginSourcesLoaded();
        const catalog = manifests.map(_toCatalogEntry).filter(Boolean);
        res.json({ ok: true, source: 'installed-plugins', count: catalog.length, catalog });
      } catch (error) {
        res.status(500).json({ ok: false, error: (error && error.message) || 'tool_catalog_projection_failed' });
      }
    });
  };
}

module.exports = { createToolsCatalogRoutes, _toCatalogEntry };
