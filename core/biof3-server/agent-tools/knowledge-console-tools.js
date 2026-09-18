'use strict';

/**
 * agent-tools/knowledge-console-tools.js — BLOCK-99 G4 空间管理会话台工具族
 *
 * /knowledge 页内嵌会话台（D3 独立轻量面）用自然语言驱动知识空间的**内容组织**：
 * 空间集合/命名/启停/文档归属/删除/重建索引/状态查询（诚实边界：不控制面板 UI
 * 布局代码本身）。与手动 UI 操作同一套 helpers 底层（双通道同一真相）。
 *
 * D7 边界：只读 + 非破坏全开；破坏性三件（删空间/清空/批量删文档）走 D4 确认门
 * —— 首调返回影响面 + 一次性 confirmToken（helpers/knowledge-confirm.js），须用户
 * 在会话中明确确认后凭 token 重调（与 run_tool ack 先例同型，但服务端硬闸校验
 * action+subject 绑定）。
 *
 * 子集绑定：context.toolSubset === 'knowledge-console' 时 run 只携带本白名单 +
 * knowledge_search/status/read 三件既有工具；其余 50+ 通用工具（exec/write/spawn
 * 等）不进入请求。policy 层（plan 模式/只读档）仍然全量生效，这里是纵深防御的
 * 最外层收窄。
 */

const ks = require('../helpers/knowledge-space');
const ingest = require('../helpers/knowledge-ingest');
const confirmStore = require('../helpers/knowledge-confirm');

const DOC_LIST_LIMIT = 50;
const GATED_ACTIONS = new Set(['knowledge_space_delete', 'knowledge_space_clear', 'knowledge_doc_delete']);

function errResult(code, message) {
  return { error: code, message };
}

// helpers 层抛 {code,message} Error → 工具层诚实错误形状（不假成功）
function fromHelperError(e, fallbackCode) {
  const code = (e && e.code) || fallbackCode || 'knowledge_error';
  return errResult(code, (e && e.message) || String(e));
}

// ── 只读 ────────────────────────────────────────────────

function tool_knowledge_space_list() {
  const spaces = ks.listSpaces();
  return {
    spaces: spaces.map((s) => ({
      id: s.id,
      name: s.name,
      enabled: !!s.enabled,
      documents: s.documents,
      chunks: s.chunks,
      isDefault: s.id === ks.SPACE_ID,
    })),
    message: spaces.map((s) => `${s.name}(${s.id})${s.enabled ? '启用' : '停用'} · 文档 ${s.documents} · 块 ${s.chunks}${s.id === ks.SPACE_ID ? ' · 默认空间' : ''}`).join('；') || '尚无空间。',
  };
}

function tool_knowledge_space_impact(args) {
  try {
    const spaceId = ks.resolveSpaceId(args && args.spaceId);
    const space = ks.getSpace(spaceId);
    return { spaceId, spaceName: space.name, isDefault: spaceId === ks.SPACE_ID, ...ks.spaceImpact(spaceId) };
  } catch (e) {
    return fromHelperError(e, 'space_not_found');
  }
}

function tool_knowledge_doc_list(args) {
  try {
    const spaceId = ks.resolveSpaceId(args && args.spaceId);
    const statusFilter = String((args && args.status) || '').trim();
    const space = ks.getSpace(spaceId);
    let docs = ks.listDocuments(spaceId);
    const total = docs.length;
    if (statusFilter) docs = docs.filter((d) => d.status === statusFilter);
    return {
      spaceId,
      spaceName: space.name,
      spaceEnabled: !!space.enabled,
      total,
      documents: docs.slice(0, DOC_LIST_LIMIT).map((d) => ({
        id: d.id,
        name: d.name,
        status: d.status,
        chunks: d.chunk_count,
        error: d.error || undefined,
      })),
      truncated: docs.length > DOC_LIST_LIMIT ? DOC_LIST_LIMIT : undefined,
      message: `空间「${space.name}」共 ${total} 篇文档。`,
    };
  } catch (e) {
    return fromHelperError(e, 'space_not_found');
  }
}

// ── 非破坏写 ────────────────────────────────────────────

function tool_knowledge_space_create(args) {
  const name = String((args && args.name) || '').trim();
  if (!name) return errResult('space_name_required', 'knowledge_space_create 需要非空 name（1..60 字符）。');
  try {
    const space = ks.createSpace(name);
    return { space: { id: space.id, name: space.name, enabled: !!space.enabled }, message: `已创建空间「${space.name}」（${space.id}，默认停用，可用 knowledge_space_enable 启用）。` };
  } catch (e) {
    return fromHelperError(e, 'space_name_invalid');
  }
}

function tool_knowledge_space_rename(args) {
  const spaceId = String((args && args.spaceId) || '').trim();
  const name = String((args && args.name) || '').trim();
  if (!spaceId || !name) return errResult('space_rename_args_required', 'knowledge_space_rename 需要 spaceId 与 name。');
  try {
    const space = ks.renameSpace(spaceId, name);
    return { space: { id: space.id, name: space.name }, message: `已改名为「${space.name}」。` };
  } catch (e) {
    return fromHelperError(e, 'space_not_found');
  }
}

function tool_knowledge_space_enable(args) {
  const enabled = args && args.enabled;
  if (typeof enabled !== 'boolean') {
    return errResult('enabled_required', 'knowledge_space_enable 需要 boolean enabled（true 启用 / false 停用）。');
  }
  try {
    const spaceId = ks.resolveSpaceId(args && args.spaceId);
    ks.setSpaceEnabled(enabled, spaceId);
    const space = ks.getSpace(spaceId);
    return { spaceId, spaceName: space.name, enabled, message: `空间「${space.name}」已${enabled ? '启用' : '停用'}。` };
  } catch (e) {
    return fromHelperError(e, 'space_not_found');
  }
}

// 绑定当前会话（ctx.conversationId 由 chat.js / agent-runner 的 toolCtx 注入）。
// 绑定默认空间 = 解绑（G3 约定：默认不落行）。
function tool_knowledge_space_bind(args, ctx) {
  const conversationId = ctx && ctx.conversationId;
  if (!conversationId) {
    return errResult('binding_conversation_required', '当前运行没有会话上下文，无法绑定空间。');
  }
  try {
    const result = ks.setSpaceBinding(conversationId, args && args.spaceId ? args.spaceId : ks.SPACE_ID);
    const space = ks.getSpace(result.spaceId);
    return {
      conversationId: result.conversationId,
      spaceId: result.spaceId,
      spaceName: space ? space.name : result.spaceId,
      message: `本会话已绑定知识空间「${space ? space.name : result.spaceId}」。`,
    };
  } catch (e) {
    return fromHelperError(e, 'space_not_found');
  }
}

function tool_knowledge_doc_move(args) {
  const docIds = args && args.docIds;
  const targetSpaceId = args && args.targetSpaceId;
  if (!Array.isArray(docIds) || docIds.length === 0) {
    return errResult('doc_ids_required', 'knowledge_doc_move 需要 docIds 数组（可经 knowledge_doc_list 获取 id）。');
  }
  if (!targetSpaceId || !String(targetSpaceId).trim()) {
    return errResult('target_space_required', 'knowledge_doc_move 需要 targetSpaceId。');
  }
  try {
    const result = ks.moveDocumentsToSpace(docIds, targetSpaceId);
    const target = ks.getSpace(result.targetSpaceId);
    return {
      moved: result.moved.length,
      missing: result.missing.length ? result.missing : undefined,
      targetSpaceId: result.targetSpaceId,
      targetSpaceName: target.name,
      message: `已将 ${result.moved.length} 篇文档移动到「${target.name}」${result.missing.length ? `；${result.missing.length} 篇未找到` : ''}。`,
    };
  } catch (e) {
    return fromHelperError(e, 'space_not_found');
  }
}

async function tool_knowledge_doc_reindex(args) {
  const docId = String((args && args.docId) || '').trim();
  if (!docId) return errResult('doc_id_required', 'knowledge_doc_reindex 需要 docId。');
  try {
    const doc = await ingest.reindexDocument(docId);
    return {
      docId: doc.id,
      name: doc.name,
      status: doc.status,
      message: doc.status === 'failed' ? `重建失败：${doc.error || '未知原因'}` : `已重新排队摄取「${doc.name}」（当前状态 ${doc.status}）。`,
    };
  } catch (e) {
    return fromHelperError(e, 'knowledge_document_not_found');
  }
}

// ── 破坏性（D4 确认门）──────────────────────────────────

// 首调（无 token）→ 返回影响面 + confirmToken + 门纪律；凭用户确认后的 token 重调才执行。
function confirmationGateResult(action, subject, impact, summary) {
  const { confirmToken, expiresInSeconds } = confirmStore.issueConfirmToken(action, subject, impact);
  return {
    confirmationRequired: true,
    action,
    impact,
    confirmToken,
    expiresInSeconds,
    message:
      `这是破坏性操作，已暂停等待用户确认。影响面：${summary}。` +
      '请向用户如实复述上述影响面，并在用户下一条消息中明确确认后才可携带本 confirmToken 重新调用本工具执行；' +
      '用户未确认前不得执行，也不得伪造或提前使用 token。若用户拒绝，请告知已取消且未做任何改动。',
  };
}

function gateDeniedResult(reason) {
  const messages = {
    confirm_token_required: '缺少 confirmToken：破坏性操作须先取得用户确认。请先向用户复述影响面（可先调本工具不带 token 获取），确认后凭 token 重调。',
    confirm_token_invalid_or_expired: 'confirmToken 无效或已过期（一次性令牌，10 分钟有效）。请重新走确认链：先向用户复述影响面，再凭新 token 执行。',
    confirm_token_subject_mismatch: 'confirmToken 与本次操作主体不匹配。请重新走确认链后再执行。',
  };
  return { error: reason, confirmationRequired: true, message: messages[reason] || '确认令牌校验未通过。' };
}

function tool_knowledge_space_delete(args) {
  try {
    const spaceId = ks.resolveSpaceId(args && args.spaceId);
    if (spaceId === ks.SPACE_ID) {
      return errResult('ks_default_undeletable', '默认空间 ks_default 不可删除（只能清空其内容或停用）。');
    }
    const space = ks.getSpace(spaceId);
    const impact = ks.spaceImpact(spaceId);
    const subject = spaceId;
    const token = args && args.confirmToken;
    if (!token) {
      return confirmationGateResult(
        'knowledge_space_delete',
        subject,
        { spaceId, spaceName: space.name, ...impact },
        `将级联删除空间「${space.name}」及其 ${impact.documents} 篇文档、${impact.chunks} 个知识块（含索引与原始文件），不可恢复；绑定该空间的会话将自动回落默认空间。`
      );
    }
    const verdict = confirmStore.consumeConfirmToken(token, 'knowledge_space_delete', subject);
    if (!verdict.ok) return gateDeniedResult(verdict.reason);
    const result = ks.deleteSpaceCascade(spaceId);
    return { ...result, message: `已删除空间「${result.name}」（${result.documents} 篇文档、${result.chunks} 个块已级联清理）。` };
  } catch (e) {
    return fromHelperError(e, 'space_not_found');
  }
}

function tool_knowledge_space_clear(args) {
  try {
    const spaceId = ks.resolveSpaceId(args && args.spaceId);
    const space = ks.getSpace(spaceId);
    const impact = ks.spaceImpact(spaceId);
    const subject = spaceId;
    const token = args && args.confirmToken;
    if (!token) {
      return confirmationGateResult(
        'knowledge_space_clear',
        subject,
        { spaceId, spaceName: space.name, ...impact },
        `将清空空间「${space.name}」的全部 ${impact.documents} 篇文档与 ${impact.chunks} 个知识块（含索引与原始文件），空间本身保留，不可恢复。`
      );
    }
    const verdict = confirmStore.consumeConfirmToken(token, 'knowledge_space_clear', subject);
    if (!verdict.ok) return gateDeniedResult(verdict.reason);
    const result = ks.clearSpace(spaceId);
    return { ...result, spaceId, spaceName: space.name, message: `已清空空间「${space.name}」（${result.cleared} 篇文档）。` };
  } catch (e) {
    return fromHelperError(e, 'space_not_found');
  }
}

function tool_knowledge_doc_delete(args) {
  const docIds = (Array.isArray(args && args.docIds) ? args.docIds : [args && args.docIds])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  if (docIds.length === 0) {
    return errResult('doc_ids_required', 'knowledge_doc_delete 需要 docIds（可经 knowledge_doc_list 获取 id）。');
  }
  // D4 门界与手动 UI 对齐：单篇删除与 REST 一致直删；批量（>1）走确认门。
  if (docIds.length > 1) {
    const subject = [...docIds].sort().join(',');
    const token = args && args.confirmToken;
    const resolved = docIds.map((id) => ks.getDocument(id)).filter(Boolean);
    const impact = { documents: resolved.length, docNames: resolved.map((d) => d.name) };
    if (!token) {
      return confirmationGateResult(
        'knowledge_doc_delete',
        subject,
        impact,
        `将批量删除 ${impact.documents} 篇文档（${impact.docNames.join('、')}）及其知识块与原始文件，不可恢复。`
      );
    }
    const verdict = confirmStore.consumeConfirmToken(token, 'knowledge_doc_delete', subject);
    if (!verdict.ok) return gateDeniedResult(verdict.reason);
  }
  const deleted = [];
  const missing = [];
  const failed = [];
  for (const docId of docIds) {
    try {
      const result = ks.deleteDocument(docId);
      deleted.push({ id: result.deleted, name: result.name });
    } catch (e) {
      if ((e && e.message) === 'knowledge_document_not_found') missing.push(docId);
      else failed.push({ id: docId, error: (e && e.message) || String(e) });
    }
  }
  return {
    deleted,
    missing: missing.length ? missing : undefined,
    failed: failed.length ? failed : undefined,
    message: `已删除 ${deleted.length} 篇文档${missing.length ? `；${missing.length} 篇未找到` : ''}${failed.length ? `；${failed.length} 篇失败` : ''}。`,
  };
}

// ── 子集绑定（D3 独立轻量面）─────────────────────────────

// 会话台白名单：既有 knowledge 三件（检索/状态/深读，均加 spaceId 透传）+ 本文件 11 件。
const KNOWLEDGE_CONSOLE_TOOL_NAMES = new Set([
  'knowledge_search',
  'knowledge_status',
  'knowledge_read',
  'knowledge_space_list',
  'knowledge_space_create',
  'knowledge_space_rename',
  'knowledge_space_enable',
  'knowledge_space_impact',
  'knowledge_space_bind',
  'knowledge_space_delete',
  'knowledge_space_clear',
  'knowledge_doc_list',
  'knowledge_doc_move',
  'knowledge_doc_delete',
  'knowledge_doc_reindex',
]);

/**
 * D3 — 会话台工具子集：context.toolSubset === 'knowledge-console' 时只下发白名单
 * 工具；其他值维持全量（现状行为，additive）。policy 层不因此绕过。
 */
function resolveToolDefsForContext(context, allDefs) {
  if (!(context && context.toolSubset === 'knowledge-console')) return allDefs;
  return allDefs.filter((def) => def && def.function && KNOWLEDGE_CONSOLE_TOOL_NAMES.has(def.function.name));
}

// 会话台纪律段：toolSubset 命中时由 agent-runner / chat.js 注入 system prompt。
const KNOWLEDGE_CONSOLE_PROMPT_SECTION =
  '\n\n=== 知识空间管理台纪律 ===' +
  '\n你是知识空间管理台的助手：通过工具帮用户以自然语言管理知识空间的**内容组织**（空间的创建/命名/启停/删除、文档的清单/归属移动/删除/重建索引、状态查询与内容检索）。' +
  '\n- 你只能调用 knowledge_* 工具族；没有其他系统能力，不要承诺面板布局调整、分析执行或文件系统操作。' +
  '\n- 破坏性操作（删空间/清空空间/批量删文档）有确认门：先调用工具取得影响面与 confirmToken，向用户如实复述影响面，必须等用户下一条消息明确确认后才携带 token 重调执行；未确认不得执行。' +
  '\n- 操作完成后用一句话向用户报告结果（对象、数量、当前状态），保持简短；列表类回答优先给名字与状态，id 仅在用户需要精确指定时展示。' +
  '\n- 检索空间内容时用 knowledge_search 并显式传目标 spaceId；未指明空间时先用 knowledge_space_list 确认现有空间。';

module.exports = {
  tool_knowledge_space_list,
  tool_knowledge_space_impact,
  tool_knowledge_doc_list,
  tool_knowledge_space_create,
  tool_knowledge_space_rename,
  tool_knowledge_space_enable,
  tool_knowledge_space_bind,
  tool_knowledge_doc_move,
  tool_knowledge_doc_reindex,
  tool_knowledge_space_delete,
  tool_knowledge_space_clear,
  tool_knowledge_doc_delete,
  KNOWLEDGE_CONSOLE_TOOL_NAMES,
  GATED_ACTIONS,
  resolveToolDefsForContext,
  KNOWLEDGE_CONSOLE_PROMPT_SECTION,
};
