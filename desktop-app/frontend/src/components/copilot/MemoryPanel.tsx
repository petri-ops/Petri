// ============================================================
// Memory Panel — shows summary (Layer 2) + structured facts (Layer 3a)
// ============================================================

import React, { useEffect, useState } from 'react';
import { fetchSummary, clearSummary, type SummaryInfo } from './copilotSummaryClient';
import {
  listFacts,
  createFact,
  updateFact,
  deleteFact,
  clearAllFacts,
  FACT_CATEGORY_LABELS,
  type UserFact,
  type FactCategory,
} from './copilotFactsClient';
import {
  listMemories,
  searchMemories,
  deleteMemory,
  clearAllMemories,
  type MemoryVector,
  type MemoryHit,
} from './copilotMemoriesClient';
import { wipeAllMemory, fetchAgentSettings, setAgentPaused } from './copilotPrivacyClient';
import {
  listPlans,
  getPlan,
  setPlanStatus,
  deletePlan,
  type PlanSummary,
  type PlanDetail,
  type PlanStatus,
  type StepStatus,
} from './copilotPlansClient';
import {
  listConversations,
  renameConversation,
  archiveConversation,
  deleteConversation,
  type ConversationSummary,
  type ConversationStatus,
} from './copilotConversationsClient';

type Tab = 'facts' | 'summary' | 'memories' | 'plans' | 'convs';

export function MemoryPanel({
  onClose,
  onChange,
  activeConvId,
  onSwitchConversation,
}: {
  onClose: () => void;
  onChange?: () => void;
  activeConvId?: string | null;
  onSwitchConversation?: (id: string | null) => void;
}) {
  const [tab, setTab] = useState<Tab>('convs');
  const [summary, setSummary] = useState<SummaryInfo | null>(null);
  const [facts, setFacts] = useState<UserFact[]>([]);
  const [memories, setMemories] = useState<MemoryVector[]>([]);
  const [memTotal, setMemTotal] = useState(0);
  const [searchQ, setSearchQ] = useState('');
  const [searchHits, setSearchHits] = useState<MemoryHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [expandedPlan, setExpandedPlan] = useState<PlanDetail | null>(null);
  const [convs, setConvs] = useState<ConversationSummary[]>([]);
  const [convFilter, setConvFilter] = useState<ConversationStatus | 'all'>('active');
  const [renamingConv, setRenamingConv] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newCategory, setNewCategory] = useState<FactCategory>('note');
  const [newContent, setNewContent] = useState('');
  const [agentPausedState, setAgentPausedState] = useState<boolean>(false);

  const refresh = async () => {
    setLoading(true);
    const [s, f, m, p, c] = await Promise.all([
      fetchSummary(),
      listFacts(),
      listMemories(),
      listPlans(),
      listConversations(convFilter),
    ]);
    setSummary(s);
    setFacts(f?.facts || []);
    setMemories(m?.memories || []);
    setMemTotal(m?.total || 0);
    setPlans(p || []);
    setConvs(c || []);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    fetchAgentSettings().then((s) => {
      if (s) setAgentPausedState(!!s.agentPaused);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convFilter]);

  const onTogglePin = async (f: UserFact) => {
    const updated = await updateFact(f.id, { pinned: !f.pinned });
    if (updated) {
      setFacts((prev) => prev.map((x) => (x.id === f.id ? updated : x)).sort(sortFacts));
      onChange?.();
    }
  };

  const onEdit = async (f: UserFact) => {
    const next = prompt('编辑事实内容:', f.content);
    if (next == null || next.trim() === '' || next === f.content) return;
    const updated = await updateFact(f.id, { content: next.trim() });
    if (updated) {
      setFacts((prev) => prev.map((x) => (x.id === f.id ? updated : x)).sort(sortFacts));
      onChange?.();
    }
  };

  const onDelete = async (f: UserFact) => {
    if (!confirm('删除这条事实？')) return;
    const ok = await deleteFact(f.id);
    if (ok) {
      setFacts((prev) => prev.filter((x) => x.id !== f.id));
      onChange?.();
    }
  };

  const onAdd = async () => {
    if (!newContent.trim()) return;
    const created = await createFact(newCategory, newContent.trim(), false);
    if (created) {
      setFacts((prev) => [created, ...prev].sort(sortFacts));
      setNewContent('');
      setAdding(false);
      onChange?.();
    }
  };

  const onClearFacts = async () => {
    if (!confirm('清空所有事实档案？这无法恢复。')) return;
    const ok = await clearAllFacts();
    if (ok) {
      setFacts([]);
      onChange?.();
    }
  };

  const onClearSummary = async () => {
    if (!confirm('清除对话摘要？')) return;
    const ok = await clearSummary();
    if (ok) {
      setSummary({ summary: null });
      onChange?.();
    }
  };

  const onSearch = async () => {
    if (!searchQ.trim() || searchQ.trim().length < 3) return;
    setSearching(true);
    const hits = await searchMemories(searchQ.trim());
    setSearchHits(hits || []);
    setSearching(false);
  };

  const onClearSearch = () => {
    setSearchQ('');
    setSearchHits(null);
  };

  const onDeleteMemory = async (id: string) => {
    if (!confirm('删除这条向量记忆？')) return;
    const ok = await deleteMemory(id);
    if (ok) {
      setMemories((prev) => prev.filter((m) => m.id !== id));
      setMemTotal((n) => Math.max(0, n - 1));
      if (searchHits) setSearchHits(searchHits.filter((h) => h.id !== id));
      onChange?.();
    }
  };

  const onClearAllMemories = async () => {
    if (!confirm('清空所有向量记忆？这无法恢复。')) return;
    const ok = await clearAllMemories();
    if (ok) {
      setMemories([]);
      setMemTotal(0);
      setSearchHits(null);
      onChange?.();
    }
  };

  const onWipeEverything = async () => {
    if (
      !confirm(
        '一键清空所有记忆？\n\n会删除：\n• 所有事实档案\n• 对话摘要\n• 所有向量记忆\n\n此操作无法恢复。'
      )
    )
      return;
    const r = await wipeAllMemory();
    if (r.ok) {
      setFacts([]);
      setSummary({ summary: null });
      setMemories([]);
      setMemTotal(0);
      setSearchHits(null);
      alert(`已清除 ${r.removed} 条记忆数据`);
      onChange?.();
    }
  };

  // ---- conversation actions ----
  const onRenameConvSubmit = async (id: string) => {
    const next = renameValue.trim();
    if (!next) {
      setRenamingConv(null);
      return;
    }
    const ok = await renameConversation(id, next);
    if (ok) {
      setConvs((prev) => prev.map((c) => (c.id === id ? { ...c, title: next } : c)));
      onChange?.();
    }
    setRenamingConv(null);
    setRenameValue('');
  };
  const onArchiveConv = async (id: string, archive: boolean) => {
    const ok = await archiveConversation(id, archive);
    if (ok) await refresh();
  };
  const onDeleteConv = async (id: string) => {
    if (!confirm('永久删除该会话和它的所有消息？无法恢复。')) return;
    const ok = await deleteConversation(id);
    if (ok) {
      if (activeConvId === id) onSwitchConversation?.(null);
      await refresh();
      onChange?.();
    }
  };
  const onSwitchConv = (id: string) => {
    onSwitchConversation?.(id);
    onClose();
  };

  // Group facts by category for display
  const byCat: Record<string, UserFact[]> = {};
  for (const f of facts) {
    (byCat[f.category] = byCat[f.category] || []).push(f);
  }
  const orderedCats: FactCategory[] = [
    'research_focus',
    'preference',
    'entity',
    'task_state',
    'note',
  ];

  return (
    <div className="cp-mem-panel">
      <div className="cp-mem-tabs">
        <button
          className={`cp-mem-tab ${tab === 'convs' ? 'active' : ''}`}
          onClick={() => setTab('convs')}
        >
          💬 会话 {convs.length > 0 && <span className="cp-mem-tab-count">{convs.length}</span>}
        </button>
        <button
          className={`cp-mem-tab ${tab === 'facts' ? 'active' : ''}`}
          onClick={() => setTab('facts')}
        >
          📌 事实 {facts.length > 0 && <span className="cp-mem-tab-count">{facts.length}</span>}
        </button>
        <button
          className={`cp-mem-tab ${tab === 'plans' ? 'active' : ''}`}
          onClick={() => setTab('plans')}
        >
          📋 任务{' '}
          {plans.filter((p) => p.status === 'active' || p.status === 'paused').length > 0 && (
            <span className="cp-mem-tab-count">
              {plans.filter((p) => p.status === 'active' || p.status === 'paused').length}
            </span>
          )}
        </button>
        <button
          className={`cp-mem-tab ${tab === 'memories' ? 'active' : ''}`}
          onClick={() => setTab('memories')}
        >
          🔍 记忆 {memTotal > 0 && <span className="cp-mem-tab-count">{memTotal}</span>}
        </button>
        <button
          className={`cp-mem-tab ${tab === 'summary' ? 'active' : ''}`}
          onClick={() => setTab('summary')}
        >
          📝 摘要
        </button>
        <span style={{ flex: 1 }} />
        <button className="cp-mem-wipe" onClick={onWipeEverything} title="一键清空所有层的记忆">
          🗑 全清
        </button>
        <button className="cp-mem-close" onClick={onClose} title="收起">
          ×
        </button>
      </div>

      <div className="cp-mem-privacy">
        🔒 你的记忆只存在 BioF3 服务器，不会发给 DeepSeek 原文 —
        只在每次对话时临时拼成提示词。可以随时清除。
      </div>

      <div className="cp-mem-agent-row">
        <div className="cp-mem-agent-text">
          <strong>自主操作 (Agent Mode)</strong>
          <span>
            {agentPausedState
              ? '已暂停 — AI 不会自动执行写操作（重命名 / 发起分析等）。'
              : '已开启 — AI 可自主执行写操作，每次操作有 5 秒撤销窗口。'}
          </span>
        </div>
        <label className="cp-mem-agent-toggle" title={agentPausedState ? '点击开启' : '点击暂停'}>
          <input
            type="checkbox"
            checked={!agentPausedState}
            onChange={async (e) => {
              const paused = !e.target.checked;
              const ok = await setAgentPaused(paused);
              if (ok) setAgentPausedState(paused);
            }}
          />
          <span className="cp-mem-agent-slider" />
        </label>
      </div>

      {tab === 'facts' && (
        <div className="cp-mem-body">
          {loading ? (
            <div className="cp-mem-empty">加载中...</div>
          ) : facts.length === 0 && !adding ? (
            <div className="cp-mem-empty">
              Copilot 还没攒下关于你的事实。聊一会儿后会自动归纳。
              <div style={{ marginTop: 10 }}>
                <button className="cp-mem-add-btn" onClick={() => setAdding(true)}>
                  + 手动添加
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="cp-mem-actions">
                {!adding && (
                  <button className="cp-mem-add-btn" onClick={() => setAdding(true)}>
                    + 添加事实
                  </button>
                )}
                {facts.length > 0 && (
                  <button className="cp-mem-clear-btn" onClick={onClearFacts}>
                    清空全部
                  </button>
                )}
              </div>
              {adding && (
                <div className="cp-mem-add-form">
                  <select
                    className="cp-mem-add-cat"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as FactCategory)}
                  >
                    {orderedCats.map((c) => (
                      <option key={c} value={c}>
                        {FACT_CATEGORY_LABELS[c]}
                      </option>
                    ))}
                  </select>
                  <input
                    className="cp-mem-add-input"
                    placeholder="例如：研究人 PBMC 数据"
                    value={newContent}
                    onChange={(e) => setNewContent(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onAdd();
                      if (e.key === 'Escape') {
                        setAdding(false);
                        setNewContent('');
                      }
                    }}
                  />
                  <button className="cp-mem-add-ok" onClick={onAdd}>
                    保存
                  </button>
                  <button
                    className="cp-mem-add-cancel"
                    onClick={() => {
                      setAdding(false);
                      setNewContent('');
                    }}
                  >
                    取消
                  </button>
                </div>
              )}
              {orderedCats.map((cat) => {
                const arr = byCat[cat];
                if (!arr || arr.length === 0) return null;
                return (
                  <div key={cat} className="cp-mem-group">
                    <div className="cp-mem-group-title">{FACT_CATEGORY_LABELS[cat]}</div>
                    {arr.map((f) => (
                      <div key={f.id} className={`cp-mem-fact ${f.pinned ? 'pinned' : ''}`}>
                        <div className="cp-mem-fact-content">
                          {f.pinned && <span className="cp-mem-fact-pin">📌</span>}
                          {f.content}
                          {f.source === 'manual' && (
                            <span className="cp-mem-fact-source">手动</span>
                          )}
                        </div>
                        <div className="cp-mem-fact-actions">
                          <button
                            onClick={() => onTogglePin(f)}
                            title={f.pinned ? '取消置顶' : '置顶'}
                          >
                            {f.pinned ? '📍' : '📌'}
                          </button>
                          <button onClick={() => onEdit(f)} title="编辑">
                            ✏
                          </button>
                          <button onClick={() => onDelete(f)} title="删除">
                            ×
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {tab === 'summary' && (
        <div className="cp-mem-body">
          {loading ? (
            <div className="cp-mem-empty">加载中...</div>
          ) : !summary?.summary ? (
            <div className="cp-mem-empty">
              当对话超过约 22 轮时，Copilot 会自动把早期对话压缩成精华段落。
            </div>
          ) : (
            <>
              <div className="cp-mem-actions">
                <button className="cp-mem-clear-btn" onClick={onClearSummary}>
                  清除摘要
                </button>
              </div>
              <div className="cp-mem-summary-text">{summary.summary}</div>
              <div className="cp-mem-summary-meta">
                {summary.msgCount ? `已归档 ${summary.msgCount} 条对话` : ''}
                {summary.updatedAt
                  ? ` · 更新于 ${new Date(summary.updatedAt).toLocaleString('zh-CN', { hour12: false })}`
                  : ''}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'memories' && (
        <div className="cp-mem-body">
          <div className="cp-mem-search">
            <input
              className="cp-mem-search-input"
              placeholder="搜索向量记忆 (按语义检索)"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSearch();
                if (e.key === 'Escape') onClearSearch();
              }}
            />
            <button
              className="cp-mem-add-btn"
              onClick={onSearch}
              disabled={searching || searchQ.trim().length < 3}
            >
              {searching ? '...' : '搜索'}
            </button>
            {searchHits && (
              <button className="cp-mem-add-cancel" onClick={onClearSearch}>
                清除
              </button>
            )}
          </div>
          {loading ? (
            <div className="cp-mem-empty">加载中...</div>
          ) : memTotal === 0 ? (
            <div className="cp-mem-empty">
              聊几轮之后，Copilot 会把每轮对话向量化存进来，未来即使你换设备登录也能召回。
            </div>
          ) : (
            <>
              <div className="cp-mem-actions">
                <span style={{ flex: 1, fontSize: 11, color: '#9ca3af', alignSelf: 'center' }}>
                  共 {memTotal} 条向量{searchHits ? ` · 搜索到 ${searchHits.length}` : ''}
                </span>
                <button className="cp-mem-clear-btn" onClick={onClearAllMemories}>
                  清空全部
                </button>
              </div>
              {(searchHits || memories).map((m: Record<string, unknown>) => (
                <div key={m.id} className="cp-mem-vec">
                  <div className="cp-mem-vec-head">
                    <span className="cp-mem-vec-kind">
                      {m.kind === 'analysis_summary'
                        ? '分析'
                        : m.kind === 'ai_interpret'
                          ? 'AI 解读'
                          : '对话'}
                    </span>
                    {m.page_title && <span className="cp-mem-vec-page">{m.page_title}</span>}
                    <span className="cp-mem-vec-time">
                      {new Date(m.ts).toLocaleDateString('zh-CN')}
                    </span>
                    {typeof m.sim === 'number' && (
                      <span className="cp-mem-vec-sim">{Math.round(m.sim * 100)}%</span>
                    )}
                    <button
                      className="cp-mem-vec-del"
                      onClick={() => onDeleteMemory(m.id)}
                      title="删除"
                    >
                      ×
                    </button>
                  </div>
                  <div className="cp-mem-vec-content">{m.content}</div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {tab === 'plans' && (
        <div className="cp-mem-body">
          {loading ? (
            <div className="cp-mem-empty">加载中...</div>
          ) : plans.length === 0 ? (
            <div className="cp-mem-empty">
              当你交给 Copilot 一个多步任务时（比如"做完整 PBMC 分析"），它会自动创建一个
              plan，并在这里显示推进状态。Plan 跨会话持久保存。
            </div>
          ) : (
            <>
              {plans.map((p) => {
                const expanded = expandedPlan?.id === p.id;
                return (
                  <div key={p.id} className={`cp-plan cp-plan-${p.status}`}>
                    <div
                      className="cp-plan-head"
                      onClick={async () => {
                        if (expanded) {
                          setExpandedPlan(null);
                        } else {
                          const detail = await getPlan(p.id);
                          setExpandedPlan(detail);
                        }
                      }}
                    >
                      <span className="cp-plan-status">{statusEmoji(p.status)}</span>
                      <div className="cp-plan-info">
                        <div className="cp-plan-title">{p.title}</div>
                        <div className="cp-plan-meta">
                          {p.done_steps}/{p.total_steps} 完成 · {statusLabel(p.status)} ·{' '}
                          {new Date(p.updated_at).toLocaleDateString('zh-CN')}
                        </div>
                      </div>
                      <span className="cp-plan-toggle">{expanded ? '▴' : '▾'}</span>
                    </div>
                    {expanded && expandedPlan && (
                      <div className="cp-plan-body">
                        {expandedPlan.chat_context_excerpt && (
                          <div className="cp-plan-excerpt" title="触发该计划的用户原话">
                            💬 {expandedPlan.chat_context_excerpt}
                          </div>
                        )}
                        {expandedPlan.goal && (
                          <div className="cp-plan-goal">🎯 {expandedPlan.goal}</div>
                        )}
                        <div className="cp-plan-steps">
                          {expandedPlan.steps.map((s) => (
                            <div key={s.n} className={`cp-plan-step cp-plan-step-${s.status}`}>
                              <span className="cp-plan-step-mark">{stepMark(s.status)}</span>
                              <div className="cp-plan-step-body">
                                <div className="cp-plan-step-title">
                                  {s.n}. {s.title}
                                </div>
                                {s.hint && <div className="cp-plan-step-hint">💡 {s.hint}</div>}
                                {s.result && (
                                  <div className="cp-plan-step-result">→ {s.result}</div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="cp-plan-actions">
                          {p.status === 'active' && (
                            <button
                              className="cp-plan-btn"
                              onClick={async () => {
                                await setPlanStatus(p.id, 'paused');
                                await refresh();
                                setExpandedPlan(null);
                              }}
                            >
                              暂停
                            </button>
                          )}
                          {p.status === 'paused' && (
                            <button
                              className="cp-plan-btn"
                              onClick={async () => {
                                await setPlanStatus(p.id, 'active');
                                await refresh();
                                setExpandedPlan(null);
                              }}
                            >
                              恢复
                            </button>
                          )}
                          {(p.status === 'active' || p.status === 'paused') && (
                            <button
                              className="cp-plan-btn"
                              onClick={async () => {
                                await setPlanStatus(p.id, 'cancelled');
                                await refresh();
                                setExpandedPlan(null);
                              }}
                            >
                              取消
                            </button>
                          )}
                          <button
                            className="cp-plan-btn cp-plan-btn-danger"
                            onClick={async () => {
                              if (!confirm('永久删除这个 plan？')) return;
                              await deletePlan(p.id);
                              await refresh();
                              setExpandedPlan(null);
                              onChange?.();
                            }}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {tab === 'convs' && (
        <div className="cp-mem-body">
          <div className="cp-mem-actions" style={{ justifyContent: 'flex-start', gap: 6 }}>
            <button
              className={`cp-conv-filter ${convFilter === 'active' ? 'active' : ''}`}
              onClick={() => setConvFilter('active')}
            >
              活跃
            </button>
            <button
              className={`cp-conv-filter ${convFilter === 'archived' ? 'active' : ''}`}
              onClick={() => setConvFilter('archived')}
            >
              已归档
            </button>
            <button
              className={`cp-conv-filter ${convFilter === 'all' ? 'active' : ''}`}
              onClick={() => setConvFilter('all')}
            >
              全部
            </button>
            <span style={{ flex: 1 }} />
            <button
              className="cp-mem-add-btn"
              onClick={() => onSwitchConversation?.(null)}
              title="开启新会话"
            >
              + 新对话
            </button>
          </div>
          {loading ? (
            <div className="cp-mem-empty">加载中...</div>
          ) : convs.length === 0 ? (
            <div className="cp-mem-empty">
              {convFilter === 'archived'
                ? '没有已归档的会话'
                : '还没有会话。在下方提问就会开启第一个会话。'}
            </div>
          ) : (
            <>
              {convs.map((c) => {
                const isActive = c.id === activeConvId;
                const isRenaming = renamingConv === c.id;
                return (
                  <div
                    key={c.id}
                    className={`cp-conv-row ${isActive ? 'active' : ''} ${c.status === 'archived' ? 'archived' : ''}`}
                  >
                    <div className="cp-conv-row-main">
                      {isRenaming ? (
                        <input
                          className="cp-conv-row-edit"
                          value={renameValue}
                          autoFocus
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') onRenameConvSubmit(c.id);
                            if (e.key === 'Escape') {
                              setRenamingConv(null);
                              setRenameValue('');
                            }
                          }}
                          onBlur={() => onRenameConvSubmit(c.id)}
                        />
                      ) : (
                        <button
                          className="cp-conv-row-title"
                          onClick={() => onSwitchConv(c.id)}
                          title={`切换到 "${c.title}"`}
                        >
                          {isActive && <span className="cp-conv-row-active-dot">●</span>}
                          {c.title || '未命名会话'}
                        </button>
                      )}
                      <div className="cp-conv-row-meta">
                        {c.message_count} 条 ·{' '}
                        {new Date(c.updated_at).toLocaleString('zh-CN', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                        })}
                        {c.status === 'archived' && <span className="cp-conv-row-tag">已归档</span>}
                      </div>
                    </div>
                    <div className="cp-conv-row-actions">
                      <button
                        onClick={() => {
                          setRenamingConv(c.id);
                          setRenameValue(c.title);
                        }}
                        title="重命名"
                      >
                        ✏
                      </button>
                      {c.status === 'active' ? (
                        <button
                          onClick={() => onArchiveConv(c.id, true)}
                          title="归档（隐藏但保留消息）"
                        >
                          🗄
                        </button>
                      ) : (
                        <button onClick={() => onArchiveConv(c.id, false)} title="恢复到活跃">
                          ↺
                        </button>
                      )}
                      <button onClick={() => onDeleteConv(c.id)} title="永久删除">
                        ×
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function sortFacts(a: UserFact, b: UserFact): number {
  if (a.pinned !== b.pinned) return b.pinned - a.pinned;
  return (b.updated_at || '').localeCompare(a.updated_at || '');
}

function statusEmoji(s: PlanStatus): string {
  return s === 'completed' ? '✅' : s === 'cancelled' ? '✗' : s === 'paused' ? '⏸' : '🚀';
}
function statusLabel(s: PlanStatus): string {
  return s === 'completed'
    ? '已完成'
    : s === 'cancelled'
      ? '已取消'
      : s === 'paused'
        ? '已暂停'
        : '进行中';
}
function stepMark(s: StepStatus): string {
  return s === 'done'
    ? '✓'
    : s === 'running'
      ? '►'
      : s === 'failed'
        ? '✗'
        : s === 'skipped'
          ? '⊘'
          : '◯';
}
