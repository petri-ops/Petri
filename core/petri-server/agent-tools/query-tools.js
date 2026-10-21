/**
 * agent-tools/query-tools.js — Data query, page reading, search tools
 */
const path = require('path');
const fs = require('fs');
const dbMod = require('../db');
const sqlite = dbMod.getDatabase();
// C3 (M2-10): content-plugin tutorial snippets (read by read_page / search)
const contentPlugins = require('./content-plugins');

// --------------------------------------------------------------
// Tool implementations
// --------------------------------------------------------------

async function tool_query(args, ctx) {
  const db = sqlite;
  const userId = ctx.userId;
  const resource = String(args.resource || '').toLowerCase();

  if (!userId) {
    const guestDataResources = ['projects', 'datasets', 'analyses', 'facts', 'memories'];
    if (guestDataResources.includes(resource)) {
      return {
        error: 'guest_no_account',
        message:
          '你当前是未登录访客，没有 Petri 账号下的项目/数据集/分析记录。请说明：你是网站访客；若要保存项目、跑分析或同步学习进度，需要注册/登录。不要调用 query 查 projects/datasets/analyses。',
        items: [],
      };
    }
    // docs/blog/figcode 仍可查（公开索引）
  }

  const id = args.id;
  const parentId = args.parentId;
  const limit = Math.max(1, Math.min(200, args.limit || 50));

  if (resource === 'docs' || resource === 'blog' || resource === 'figcode') {
    const idx = ctx.docsIndex;
    if (!idx) return [];
    const arr = idx[resource] || [];
    if (id) {
      return arr.find((x) => x.id === id || x.url === id) || null;
    }
    return arr.slice(0, limit);
  }

  if (!userId) {
    return { error: 'unauthorized', message: '未登录，无法查询该资源' };
  }

  if (resource === 'projects') {
    if (id) {
      return (
        db.prepare('SELECT * FROM projects WHERE id=? AND user_id=?').get(id, userId) ||
        { error: 'project_not_found', id }
      );
    }
    return db
      .prepare('SELECT * FROM projects WHERE user_id=? ORDER BY updated_at DESC LIMIT ?')
      .all(userId, limit);
  }
  if (resource === 'datasets') {
    if (id) {
      return (
        db
          .prepare(
            `SELECT d.* FROM datasets d JOIN projects p ON d.project_id=p.id WHERE d.id=? AND p.user_id=?`
          )
          .get(id, userId) || { error: 'dataset_not_found', id }
      );
    }
    if (parentId) {
      return db
        .prepare(
          `SELECT d.* FROM datasets d JOIN projects p ON d.project_id=p.id WHERE p.user_id=? AND d.project_id=? ORDER BY uploaded_at DESC LIMIT ?`
        )
        .all(userId, parentId, limit);
    }
    return db
      .prepare(
        `SELECT d.* FROM datasets d JOIN projects p ON d.project_id=p.id WHERE p.user_id=? ORDER BY uploaded_at DESC LIMIT ?`
      )
      .all(userId, limit);
  }
  if (resource === 'analyses') {
    if (id) {
      return (
        db
          .prepare(
            `SELECT a.* FROM analyses a JOIN datasets d ON a.dataset_id=d.id JOIN projects p ON d.project_id=p.id WHERE a.id=? AND p.user_id=?`
          )
          .get(id, userId) || { error: 'analysis_not_found', id }
      );
    }
    if (parentId) {
      return db
        .prepare(
          `SELECT a.* FROM analyses a JOIN datasets d ON a.dataset_id=d.id JOIN projects p ON d.project_id=p.id WHERE p.user_id=? AND a.dataset_id=? ORDER BY created_at DESC LIMIT ?`
        )
        .all(userId, parentId, limit);
    }
    return db
      .prepare(
        `SELECT a.* FROM analyses a JOIN datasets d ON a.dataset_id=d.id JOIN projects p ON d.project_id=p.id WHERE p.user_id=? ORDER BY a.created_at DESC LIMIT ?`
      )
      .all(userId, limit);
  }
  if (resource === 'facts') {
    return ctx.projectId
      ? db.prepare('SELECT * FROM user_facts WHERE user_id=? AND project_id=? ORDER BY pinned DESC, updated_at DESC LIMIT ?').all(userId, String(ctx.projectId), limit)
      : db.prepare("SELECT * FROM user_facts WHERE user_id=? AND COALESCE(project_id, '')='' ORDER BY pinned DESC, updated_at DESC LIMIT ?").all(userId, limit);
  }
  if (resource === 'memories') {
    return ctx.projectId
      ? db.prepare('SELECT id, kind, ref_id, page, page_title, content, ts FROM memory_vectors WHERE user_id=? AND project_id=? ORDER BY ts DESC LIMIT ?').all(userId, String(ctx.projectId), limit)
      : db.prepare("SELECT id, kind, ref_id, page, page_title, content, ts FROM memory_vectors WHERE user_id=? AND COALESCE(project_id, '')='' ORDER BY ts DESC LIMIT ?").all(userId, limit);
  }

  throw new Error('未知 resource: ' + resource);
}

async function tool_read_page(args, ctx) {
  const url = String(args.url || '');
  if (!url) throw new Error('缺少 url');

  // C3: content-plugin scoped URL → /plugin/<pluginId>/<slug>
  const pluginRef = contentPlugins.parsePluginUrl(url);
  if (pluginRef) {
    return contentPlugins.readPluginDoc(pluginRef.pluginId, pluginRef.slug);
  }

  // Map URL to file path on disk
  // /docs/single-cell/module05 → docs/single-cell/module05.md
  // /blog/welcome-to-petri   → blog/2024-05-06-welcome-to-petri.md (lookup via index)
  // /figcode#volcano         → figcode card content
  const idx = ctx.docsIndex || {};

  if (url.startsWith('/figcode')) {
    const hashIdx = url.indexOf('#');
    if (hashIdx >= 0) {
      const cardId = url.slice(hashIdx + 1);
      const card = (idx.figcode || []).find((c) => c.id === cardId);
      if (!card) return { error: 'figcode card not found: ' + cardId };
      return { kind: 'figcode', ...card };
    }
    return {
      kind: 'figcode-list',
      cards: (idx.figcode || []).map((c) => ({ id: c.id, title: c.title, category: c.category })),
    };
  }

  if (url.startsWith('/docs') || url.startsWith('docs')) {
    // Find in docs index for confirmation
    const meta = (idx.docs || []).find((d) => d.url === url || d.url === url.replace(/\/$/, ''));
    // Read raw file
    const rel = url.replace(/^\//, '') + '.md';
    const _candidate = path.join('/opt/petri-tutorial/current-site/..', rel); // probably wrong; try multiple
    for (const root of [
      '/root/Petri',
      '/opt/petri-content',
      '/opt/Petri',
      process.env.PETRI_CONTENT_ROOT,
    ].filter(Boolean)) {
      try {
        const p = path.join(root, rel);
        if (fs.existsSync(p)) {
          const text = fs.readFileSync(p, 'utf-8');
          return { kind: 'docs', url, title: meta && meta.title, content: text.slice(0, 8000) };
        }
      } catch {}
    }
    // Fallback: HTTP fetch from petri.com
    return await fetchPageHtml(url);
  }

  if (url.startsWith('/blog')) {
    return await fetchPageHtml(url);
  }

  return { error: 'unsupported url: ' + url };
}

async function fetchPageHtml(url) {
  const fullUrl = 'https://petri.com' + url;
  return new Promise((resolve) => {
    const https = require('https');
    let buf = '';
    const req = https.get(fullUrl, { timeout: 8000 }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        // Strip HTML tags for compact representation
        const text = buf
          .replace(/<script[\s\S]*?<\/script>/g, '')
          .replace(/<style[\s\S]*?<\/style>/g, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        resolve({ kind: 'html', url, content: text.slice(0, 6000) });
      });
    });
    req.on('error', () => resolve({ error: 'fetch failed' }));
    req.on('timeout', () => {
      try {
        req.destroy();
      } catch {}
      resolve({ error: 'fetch timeout' });
    });
  });
}

async function tool_search(args, ctx) {
  const q = String(args.q || '').trim();
  if (!q) return [];
  const topK = Math.max(1, Math.min(15, args.topK || 5));
  const scope = args.scope || 'all';
  const userId = ctx.userId;

  const results = [];

  // 1) Lexical search across docs/blog/figcode (skip when scope is plugins-only)
  if (scope === 'all' || scope === 'docs' || scope === 'figcode') {
    const idx = ctx.docsIndex || {};
    const ql = q.toLowerCase();
    const candidates = [
      ...(scope === 'figcode' ? [] : (idx.docs || []).map((x) => ({ ...x, kind: 'doc' }))),
      ...(scope === 'figcode' ? [] : (idx.blog || []).map((x) => ({ ...x, kind: 'blog' }))),
      ...(scope === 'docs' ? [] : (idx.figcode || []).map((x) => ({ ...x, kind: 'figcode' }))),
    ];
    for (const c of candidates) {
      const haystack = (
        (c.title || '') +
        ' ' +
        (c.subtitle || '') +
        ' ' +
        (c.summary || '') +
        ' ' +
        (c.biologicalQuestion || '') +
        ' ' +
        (c.headings || []).join(' ')
      ).toLowerCase();
      const tokens = ql.split(/\s+/).filter((t) => t.length >= 2);
      let score = 0;
      for (const t of tokens) {
        if (haystack.includes(t)) score += 1;
      }
      if (score > 0) {
        results.push({
          kind: c.kind,
          title: c.title,
          url: c.url || (c.kind === 'figcode' ? '/figcode#' + c.id : null),
          summary: (c.summary || c.biologicalQuestion || '').slice(0, 200),
          relevance: score / Math.max(1, tokens.length),
        });
      }
    }
  }

  // 1b) C3: lexical search across content-plugin tutorial snippets
  if (scope === 'all' || scope === 'plugins') {
    try {
      const pluginResults = contentPlugins.searchPluginDocs(q, topK);
      for (const r of pluginResults) results.push(r);
    } catch {
      /* content plugins not available — ignore */
    }
  }

  // 2) Semantic search over user's vector memories
  if ((scope === 'all' || scope === 'memories') && userId && ctx.dashscopeEmbed && ctx.cosineSim) {
    try {
      const vecs = await ctx.dashscopeEmbed([q], { userId });
      if (vecs && vecs[0]) {
        const db = sqlite;
        const rows = ctx.projectId
          ? db.prepare('SELECT id, kind, content, ts, page, page_title, embedding FROM memory_vectors WHERE user_id=? AND project_id=? LIMIT 1000').all(userId, String(ctx.projectId))
          : db.prepare("SELECT id, kind, content, ts, page, page_title, embedding FROM memory_vectors WHERE user_id=? AND COALESCE(project_id, '')='' LIMIT 1000").all(userId);
        for (const r of rows) {
          const v = new Float32Array(
            r.embedding.buffer,
            r.embedding.byteOffset,
            r.embedding.byteLength / 4
          );
          const sim = ctx.cosineSim(vecs[0], v);
          if (sim >= 0.5) {
            results.push({
              kind: 'memory',
              title: r.page_title || (r.kind === 'chat_turn' ? '历史对话' : r.kind),
              url: null,
              summary: r.content.slice(0, 300),
              when: r.ts,
              relevance: sim,
            });
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Sort + dedup + cap
  results.sort((a, b) => (b.relevance || 0) - (a.relevance || 0));
  return results.slice(0, topK);
}

module.exports = {
  tool_query,
  tool_read_page,
  fetchPageHtml,
  tool_search,
  contentPlugins,
};
