// ============================================================
// src/plugin/content-plugin.js — content plugin docs & registration
//
// Extracted from src/plugin-manager.js by BLOCK-9.2 PHASE 3.
// Original location: lines 1081-1199 (registerContentPlugin /
// unregisterContentPlugin / listContentPluginDocs /
// readContentPluginDoc / listAllContentPlugins / extractMdTitle /
// extractSidebarPos).
//
// Content plugins are docs/tutorials distributed as zips — they expose a
// docsDir of .md/.mdx files. The registry lives on globalThis
// (`globalThis._biof3ContentPlugins`) so install/load-time code can
// populate it and runtime read paths can consume it from any module.
// ============================================================

const fs = require('fs');
const path = require('path');

function registerContentPlugin(pluginDir, meta) {
  try {
    if (!globalThis._biof3ContentPlugins) globalThis._biof3ContentPlugins = new Map();
    const docsDir = path.join(pluginDir, meta.docsDir || 'docs');
    globalThis._biof3ContentPlugins.set(meta.id, {
      id: meta.id,
      contentType: meta.contentType || 'tutorial',
      omics: meta.omics || 'general',
      version: meta.version,
      title: meta.title || meta.id,
      pluginDir,
      docsDir,
    });
    console.log(`[plugin] content-plugin registered: ${meta.id} → ${docsDir}`);
  } catch (e) {
    console.warn(`[plugin] content-plugin register failed: ${e.message}`);
  }
}

function unregisterContentPlugin(pluginId) {
  if (globalThis._biof3ContentPlugins) {
    globalThis._biof3ContentPlugins.delete(pluginId);
  }
}

// 列出某 content-plugin 的文档树（递归扫 docsDir 下的 .md/.mdx）
// 返回 [{ id, title, position, relativePath }]
function listContentPluginDocs(pluginId) {
  const entry = globalThis._biof3ContentPlugins && globalThis._biof3ContentPlugins.get(pluginId);
  if (!entry) return [];
  const items = [];
  try {
    const walk = (dir, relPrefix) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) {
          walk(path.join(dir, e.name), relPrefix ? `${relPrefix}/${e.name}` : e.name);
        } else if (/\.mdx?$/.test(e.name) && !e.name.startsWith('_')) {
          const fullPath = path.join(dir, e.name);
          const relativePath = relPrefix ? `${relPrefix}/${e.name}` : e.name;
          const docId = relativePath.replace(/\.(md|mdx)$/, '').replace(/\/index$/, '');
          let raw = '';
          try {
            raw = fs.readFileSync(fullPath, 'utf8');
          } catch {}
          items.push({
            id: `${pluginId}/${docId}`,
            title: extractMdTitle(raw) || docId,
            position: extractSidebarPos(raw),
            relativePath,
            pluginId,
          });
        }
      }
    };
    walk(entry.docsDir, '');
    items.sort((a, b) => a.position - b.position);
  } catch (e) {
    console.warn(`[plugin] listContentPluginDocs ${pluginId} failed: ${e.message}`);
  }
  return items;
}

// 读取 content-plugin 内某文档的 md 文本（按 relativePath）
function readContentPluginDoc(pluginId, relativePath) {
  const entry = globalThis._biof3ContentPlugins && globalThis._biof3ContentPlugins.get(pluginId);
  if (!entry) throw new Error(`content-plugin ${pluginId} 未注册`);
  // 防止路径穿越：解析后必须在 docsDir 内
  const resolved = path.resolve(entry.docsDir, relativePath);
  if (!resolved.startsWith(entry.docsDir + path.sep) && resolved !== entry.docsDir) {
    throw new Error('非法文档路径: ' + relativePath);
  }
  if (!/\.mdx?$/.test(resolved)) throw new Error('仅支持 .md/.mdx');
  if (!fs.existsSync(resolved)) throw new Error('文档不存在: ' + relativePath);
  return fs.readFileSync(resolved, 'utf8');
}

// 列出所有已注册 content-plugin 元数据（供前端 sidebar 顶层分类用）
function listAllContentPlugins() {
  if (!globalThis._biof3ContentPlugins) return [];
  const out = [];
  for (const [, e] of globalThis._biof3ContentPlugins) {
    out.push({
      id: e.id,
      contentType: e.contentType,
      omics: e.omics,
      version: e.version,
      title: e.title,
      pluginDir: e.pluginDir,
      docsDir: e.docsDir,
    });
  }
  return out;
}

// 从 md frontmatter / 首个 H1 提取标题
function extractMdTitle(raw) {
  if (!raw) return '';
  // frontmatter: ---\ntitle: foo\n---
  const m = raw.match(/^---\s*\n[\s\S]*?title:\s*(.+?)\s*\n[\s\S]*?---/);
  if (m) return m[1].trim();
  // 首个 H1: # Title
  const h1 = raw.match(/^#\s+(.+?)\s*$/m);
  return h1 ? h1[1].trim() : '';
}

// 从 md frontmatter 提取 sidebar position（数字，越小越靠前）
function extractSidebarPos(raw) {
  if (!raw) return 0;
  const m = raw.match(/^---\s*\n[\s\S]*?sidebar_position:\s*(-?\d+)\s*\n[\s\S]*?---/);
  if (m) return parseInt(m[1], 10);
  return 0;
}

module.exports = {
  registerContentPlugin,
  unregisterContentPlugin,
  listContentPluginDocs,
  readContentPluginDoc,
  listAllContentPlugins,
};
