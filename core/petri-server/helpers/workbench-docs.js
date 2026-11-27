'use strict';

/**
 * item88 文档链（设计稿 §3.3）：wb_documents append-only，只 INSERT，
 * chain_hash 串接；修正以新版本表达，篡改任一环 verifier 红。
 */

const crypto = require('node:crypto');

function chainHash(prevHash, contentJson) {
  return crypto.createHash('sha256').update(`${prevHash || ''}|${contentJson}`).digest('hex');
}

function appendWorkbenchDoc(db, { id, taskId = null, type, version = 1, content, createdAt } = {}) {
  if (!id || !type) throw new Error('workbench_doc_id_type_required');
  const contentJson = typeof content === 'string' ? content : JSON.stringify(content == null ? {} : content);
  const prev = db.prepare('SELECT chain_hash FROM wb_documents ORDER BY rowid DESC LIMIT 1').get();
  const prevHash = prev ? prev.chain_hash : null;
  const hash = chainHash(prevHash, contentJson);
  const ts = createdAt || new Date().toISOString();
  db.prepare('INSERT INTO wb_documents (id, task_id, type, version, content_json, prev_chain_hash, chain_hash, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, taskId, type, version, contentJson, prevHash, hash, ts);
  return {
    id, task_id: taskId, type, version, content: contentJson,
    prev_chain_hash: prevHash, chain_hash: hash, created_at: ts,
  };
}

function verifyWorkbenchDocChain(docs) {
  let prev = null;
  for (const doc of docs || []) {
    if (!doc) return { ok: false, error: 'empty_doc' };
    if ((doc.prev_chain_hash || null) !== prev) return { ok: false, error: 'chain_break', id: doc.id };
    const content = typeof doc.content === 'string' ? doc.content : JSON.stringify(doc.content == null ? {} : doc.content);
    if (chainHash(prev, content) !== doc.chain_hash) return { ok: false, error: 'hash_mismatch', id: doc.id };
    prev = doc.chain_hash;
  }
  return { ok: true };
}

module.exports = { chainHash, appendWorkbenchDoc, verifyWorkbenchDocChain };
