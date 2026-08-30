/**
 * agent-tools/content-plugins.js — C3 (M2-10): Copilot context activation
 *
 * Lets read_page / search read tutorial snippets shipped by *content plugins*.
 *
 * Content plugins (M2-9, in progress) are expected to register themselves on
 * `globalThis._biof3ContentPlugins` as an array of objects with at least:
 *   {
 *     id:        'deseq2-tutorial',
 *     title:     'DESeq2 差异分析教程',
 *     docs:      [ { slug:'quickstart', title:'快速上手', file:'/abs/path/quickstart.md' } ],
 *     docsDir:   '/abs/path/to/docs',           // optional, used as scan root
 *     manifest:  { ... }                         // optional plugin manifest
 *   }
 *
 * If the registry is not populated yet (M2-9 not landed), this module falls
 * back to scanning a configurable content-plugins directory on disk so the
 * Copilot can already read shipped md snippets. The scan root is resolved from
 * (in order):
 *   1. globalThis._biof3ContentPlugins           (M2-9 runtime registry)
 *   2. process.env.BIOF3_CONTENT_PLUGINS_DIR     (explicit override)
 *   3. <repo>/content-plugins                    (convention)
 *   4. <repo>/desktop-app/resources/content-plugins
 *
 * Each discovered plugin contributes its *.md files. Files are read lazily and
 * cached for CONTENT_PLUGIN_TTL ms.
 */

const fs = require('fs');
const path = require('path');

const CONTENT_PLUGIN_TTL = 5 * 60 * 1000; // 5 min

let _cache = null; // { plugins: [...], ts: number }

// --------------------------------------------------------------
// Candidate roots for the on-disk fallback scan
// --------------------------------------------------------------
function _candidateRoots() {
  const roots = [];
  if (process.env.BIOF3_CONTENT_PLUGINS_DIR) roots.push(process.env.BIOF3_CONTENT_PLUGINS_DIR);
  // biof3-server is at <repo>/biof3-server; repo root is two levels up from this file
  const repoRoot = path.resolve(__dirname, '..', '..');
  roots.push(path.join(repoRoot, 'content-plugins'));
  // 去 submodule 后：core 内嵌在 desktop 仓根 core/ 下，content-plugins 在 desktop 仓根 resources/
  // biof3-server/agent-tools/ → biof3-server → core → desktop 仓根 → resources/content-plugins
  const splitPath = path.resolve(__dirname, '..', '..', '..', 'resources', 'content-plugins');
  roots.push(splitPath);
  if (process.resourcesPath) {
    roots.push(path.join(process.resourcesPath, 'content-plugins'));
  }
  return roots;
}

function _listMdFiles(dir, baseDir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      // skip node_modules / hidden dirs
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      out.push(..._listMdFiles(full, baseDir));
    } else if (e.isFile() && e.name.endsWith('.md')) {
      const rel = path.relative(baseDir, full).replace(/\\/g, '/');
      // Derive a slug from the relative path without extension
      const slug = rel.replace(/\.md$/i, '');
      out.push({ slug, file: full, rel });
    }
  }
  return out;
}

function _extractTitle(filePath, fallbackSlug) {
  try {
    const head = fs.readFileSync(filePath, 'utf-8').slice(0, 600);
    // 1) frontmatter `title:`
    const fm = head.match(/^---\s*\n([\s\S]*?)\n---/);
    if (fm) {
      const t = fm[1].match(/^title:\s*(.+)/m);
      if (t && t[1]) return t[1].replace(/^["']|["']$/g, '').trim();
      const sb = fm[1].match(/^sidebar_(?:label|position):\s*(.+)/m);
      if (sb && sb[1]) return sb[1].replace(/^["']|["']$/g, '').trim();
    }
    // 2) first H1
    const h1 = head.match(/^#\s+(.+)/m);
    if (h1 && h1[1]) return h1[1].trim();
  } catch {}
  return fallbackSlug;
}

function _scanDiskPlugins() {
  const plugins = [];
  for (const root of _candidateRoots()) {
    let pluginDirs;
    try {
      pluginDirs = fs.readdirSync(root, { withFileTypes: true }).filter(
        (e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules'
      );
    } catch {
      continue;
    }
    for (const pd of pluginDirs) {
      const pluginDir = path.join(root, pd.name);
      // docs/ subdir is the convention; if absent, treat the plugin dir itself
      const docsDir = fs.existsSync(path.join(pluginDir, 'docs'))
        ? path.join(pluginDir, 'docs')
        : pluginDir;
      const files = _listMdFiles(docsDir, docsDir);
      if (files.length === 0) continue;
      const docs = files.map((f) => ({
        slug: f.slug,
        title: _extractTitle(f.file, f.slug),
        file: f.file,
      }));
      plugins.push({
        id: pd.name,
        title: pd.name,
        docsDir,
        docs,
      });
    }
    if (plugins.length > 0) break; // first root that yields plugins wins
  }
  return plugins;
}

/**
 * Return the list of content plugins (runtime registry first, disk fallback).
 * Shape: [{ id, title, docs:[{slug,title,file}], docsDir }]
 */
function getContentPlugins() {
  // 1) M2-9 runtime registry
  const registry = globalThis._biof3ContentPlugins;
  if (Array.isArray(registry) && registry.length > 0) {
    return registry.map((p) => ({
      id: p.id,
      title: p.title || p.id,
      docs: Array.isArray(p.docs) ? p.docs : [],
      docsDir: p.docsDir,
    }));
  }
  // 2) disk fallback (cached)
  if (_cache && Date.now() - _cache.ts < CONTENT_PLUGIN_TTL) {
    return _cache.plugins;
  }
  const plugins = _scanDiskPlugins();
  _cache = { plugins, ts: Date.now() };
  return plugins;
}

/** Invalidate the disk-scan cache (used by tests / after plugin install). */
function invalidateContentPluginCache() {
  _cache = null;
}

// --------------------------------------------------------------
// Read helpers
// --------------------------------------------------------------
const MAX_SNIPPET_CHARS = 8000;

/**
 * Read a single plugin doc by pluginId + slug.
 * Returns { kind:'plugin', pluginId, slug, title, content } or { error }.
 */
function readPluginDoc(pluginId, slug) {
  const plugins = getContentPlugins();
  const plugin = plugins.find((p) => p.id === pluginId);
  if (!plugin) return { error: 'plugin_not_found', message: '未知内容插件: ' + pluginId };
  const doc = (plugin.docs || []).find(
    (d) => d.slug === slug || d.slug === String(slug).replace(/^\//, '')
  );
  if (!doc) return { error: 'doc_not_found', message: `插件 ${pluginId} 未找到文档: ${slug}` };
  try {
    const text = fs.readFileSync(doc.file, 'utf-8');
    return {
      kind: 'plugin',
      pluginId,
      slug,
      title: doc.title || slug,
      content: text.slice(0, MAX_SNIPPET_CHARS),
    };
  } catch (e) {
    return { error: 'read_failed', message: String(e && e.message || e) };
  }
}

/**
 * Parse a plugin-scoped URL of the form /plugin/<pluginId>/<slug...> or
 * /plugins/<pluginId>/<slug...>. Returns { pluginId, slug } or null.
 */
function parsePluginUrl(url) {
  const m = String(url).match(/^\/plugins?\/([^/]+)\/?(.*)$/);
  if (!m) return null;
  return { pluginId: decodeURIComponent(m[1]), slug: m[2] || 'index' };
}

/**
 * Lexical search across plugin doc titles + first chunk of content.
 * Returns [{ kind:'plugin', pluginId, slug, title, url, summary, relevance }].
 */
function searchPluginDocs(q, topK) {
  const ql = String(q || '').toLowerCase().trim();
  if (!ql) return [];
  topK = Math.max(1, Math.min(15, topK || 5));
  const tokens = ql.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length === 0) return [];
  const plugins = getContentPlugins();
  const results = [];
  for (const plugin of plugins) {
    for (const doc of plugin.docs || []) {
      const title = doc.title || doc.slug;
      let body = '';
      try {
        body = fs.readFileSync(doc.file, 'utf-8').slice(0, 2000);
      } catch {}
      const haystack = (title + ' ' + body).toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (haystack.includes(t)) score += 1;
      }
      if (score > 0) {
        // summarize: first non-frontmatter, non-H1 paragraph
        let summary = body
          .replace(/^---[\s\S]*?---/, '')
          .replace(/^#{1,6}\s+.*$/gm, '')
          .trim()
          .split(/\n\s*\n/)[0];
        summary = summary.replace(/\s+/g, ' ').trim().slice(0, 200);
        results.push({
          kind: 'plugin',
          pluginId: plugin.id,
          title,
          slug: doc.slug,
          url: `/plugin/${plugin.id}/${doc.slug}`,
          summary,
          relevance: score / tokens.length,
        });
      }
    }
  }
  results.sort((a, b) => (b.relevance || 0) - (a.relevance || 0));
  return results.slice(0, topK);
}

/**
 * Render a compact catalog of plugin docs for system-prompt injection.
 */
function renderContentPluginsForPrompt(maxChars) {
  const plugins = getContentPlugins();
  if (!plugins || plugins.length === 0) return '';
  maxChars = maxChars || 1200;
  let out = '\n\n=== 已装内容插件教程片段 ===\n';
  out += '注：分析现场卡住、不确定某工具/流程怎么用时，用 read_page(url="/plugin/<id>/<slug>") 或 search 查对应教程片段。\n';
  for (const plugin of plugins) {
    out += `\n[plugin:${plugin.id}]${plugin.title ? ' ' + plugin.title : ''}`;
    for (const doc of (plugin.docs || []).slice(0, 12)) {
      const line = `\n- /plugin/${plugin.id}/${doc.slug} — ${doc.title || doc.slug}`;
      if (out.length + line.length > maxChars) {
        out += '\n... (more)';
        return out;
      }
      out += line;
    }
  }
  return out;
}

module.exports = {
  getContentPlugins,
  invalidateContentPluginCache,
  readPluginDoc,
  parsePluginUrl,
  searchPluginDocs,
  renderContentPluginsForPrompt,
  MAX_SNIPPET_CHARS,
};
