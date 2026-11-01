// ============================================================
// DesktopSettingsPanel — Agent 用户规则面板（BLOCK-160 W2 P2/ORC-1）
//
// 规则列表式增删改：匹配器（path-glob / command-token）+ 动作（deny /
// require-ack / observe / allow）+ 作用域（global）。数据源 = /api/ai/agent-rules
// CRUD，持久化 = $PETRI_LOCAL_DATA_DIR/agent-rules.json（拦截器缓存读取，
// 重启不敏感——helper mtime 缓存 3s 内自愈）。语义：first-match 先到先判。
// BLOCK-323 放权坡道：observe = 命中只记录「本可自动执行」不拦截；
// allow = 命中自动放行（动态防护/循环防护不豁免）。复盘区 = 未复盘观察
// （一键升级 allow / 收权 require-ack / 标已复盘）+ 近期自动放行 + 规则变更留痕。
// ============================================================

import React, { useCallback, useEffect, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

type RuleAction = 'deny' | 'require-ack' | 'observe' | 'allow';

const ACTION_LABELS: Record<RuleAction, string> = {
  deny: '拒绝',
  'require-ack': '需确认',
  observe: '观察',
  allow: '放行',
};

interface AgentRule {
  id: string;
  matcher: { type: 'path-glob' | 'command-token'; pattern: string };
  action: RuleAction;
  scope: 'global';
  note?: string;
}

interface PolicyObservation {
  id: number;
  kind: 'rule-observe' | 'tool-observe' | 'rule-auto-allow' | 'policy-change';
  ruleId: string | null;
  toolName: string | null;
  fingerprint: string;
  samplePreview: string | null;
  hits: number;
  firstSeenAt: string;
  lastSeenAt: string;
  reviewedAt: string | null;
}

interface ObservationsResponse {
  status: string;
  unreviewed?: PolicyObservation[];
  autoAllow?: PolicyObservation[];
  policyChanges?: PolicyObservation[];
  unreviewedCount?: number;
  error?: string;
}

interface RulesResponse {
  status: string;
  rules?: AgentRule[];
  error?: string;
}

function authHeaders(contentType?: string): Record<string, string> {
  const token = getToken();
  return {
    ...(contentType ? { 'content-type': contentType } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function shortTime(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function shortPreview(text: string | null): string {
  if (!text) return '';
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

export function AgentRulesPanel(): React.ReactElement {
  const [rules, setRules] = useState<AgentRule[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [matcherType, setMatcherType] = useState<'path-glob' | 'command-token'>('path-glob');
  const [pattern, setPattern] = useState('');
  const [action, setAction] = useState<RuleAction>('require-ack');
  const [note, setNote] = useState('');
  // BLOCK-323 放权坡道复盘区
  const [unreviewed, setUnreviewed] = useState<PolicyObservation[]>([]);
  const [autoAllow, setAutoAllow] = useState<PolicyObservation[]>([]);
  const [policyChanges, setPolicyChanges] = useState<PolicyObservation[]>([]);

  const refreshObservations = useCallback((): (() => void) => {
    let cancelled = false;
    void fetch(`${getPlatformApiPrefix()}/ai/policy-observations`, {
      headers: authHeaders(),
    }).then(async (response) => {
      const data = (await response.json()) as ObservationsResponse;
      if (!response.ok || data?.status !== 'ok') throw new Error(data?.error || '观察读取失败');
      if (!cancelled) {
        setUnreviewed(Array.isArray(data.unreviewed) ? data.unreviewed : []);
        setAutoAllow(Array.isArray(data.autoAllow) ? data.autoAllow : []);
        setPolicyChanges(Array.isArray(data.policyChanges) ? data.policyChanges : []);
      }
    }).catch(() => { /* 观察面读取失败静默（面板其余部分不受影响） */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // DecisionUsagePanel 同款：fetch 内联 effect，then 里才 setState（规避级联渲染规则）
    let cancelled = false;
    void fetch(`${getPlatformApiPrefix()}/ai/agent-rules`, {
      headers: authHeaders(),
    }).then(async (response) => {
      const data = (await response.json()) as RulesResponse;
      if (!response.ok || data?.status !== 'ok') throw new Error(data?.error || '规则读取失败');
      if (!cancelled) {
        setRules(Array.isArray(data.rules) ? data.rules : []);
        setError('');
      }
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    });
    const cancelObservations = refreshObservations();
    return () => {
      cancelled = true;
      cancelObservations();
    };
  }, [refreshObservations]);

  async function addRule(): Promise<void> {
    const trimmed = pattern.trim();
    if (!trimmed) {
      setError('匹配模式不能为空');
      return;
    }
    const rule: AgentRule = {
      id: `rule-${Date.now().toString(36)}`,
      matcher: { type: matcherType, pattern: trimmed },
      action,
      scope: 'global',
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    try {
      const next = [...(rules ?? []), rule];
      const response = await fetch(`${getPlatformApiPrefix()}/ai/agent-rules`, {
        method: 'PUT',
        headers: authHeaders('application/json'),
        body: JSON.stringify({ rules: next }),
      });
      const data = (await response.json()) as RulesResponse & { count?: number };
      if (!response.ok || data?.status !== 'ok') throw new Error(data?.error || '规则保存失败');
      setRules(next);
      setPattern('');
      setNote('');
      setNotice('规则已保存（立即生效）');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function removeRule(id: string): Promise<void> {
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/ai/agent-rules/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = (await response.json()) as RulesResponse & { count?: number };
      if (!response.ok || data?.status !== 'ok') throw new Error(data?.error || '规则删除失败');
      setRules((prev) => (prev ?? []).filter((r) => r.id !== id));
      setNotice('规则已删除');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  /** BLOCK-323 — 规则动作升级（复盘升级流：observe → allow / require-ack）。 */
  async function setRuleAction(id: string, nextAction: RuleAction): Promise<void> {
    try {
      const next = (rules ?? []).map((rule) => (rule.id === id ? { ...rule, action: nextAction } : rule));
      const response = await fetch(`${getPlatformApiPrefix()}/ai/agent-rules`, {
        method: 'PUT',
        headers: authHeaders('application/json'),
        body: JSON.stringify({ rules: next }),
      });
      const data = (await response.json()) as RulesResponse & { count?: number };
      if (!response.ok || data?.status !== 'ok') throw new Error(data?.error || '规则保存失败');
      setRules(next);
      setNotice(`规则已升级为「${ACTION_LABELS[nextAction]}」（立即生效）`);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  /** BLOCK-323 — 观察标为已复盘（退出待复盘列表；新观察再触发通知）。 */
  async function markReviewed(ids: number[]): Promise<void> {
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/ai/policy-observations/review`, {
        method: 'POST',
        headers: authHeaders('application/json'),
        body: JSON.stringify({ ids }),
      });
      const data = (await response.json()) as { status: string; updated?: number; error?: string };
      if (!response.ok || data?.status !== 'ok') throw new Error(data?.error || '复盘标记失败');
      refreshObservations();
      setNotice('已标为复盘');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <div className="petri-usage-resource">
      <div className="petri-resource-heading">
        <div>
          <strong>Agent 用户规则</strong>
          <p>
            工具调用拦截规则（first-match 先到先判）：路径 glob（如 secrets/**、results/**）或命令首 token
            （如 npm、curl）→ 拒绝 / 需确认 / 观察（放权坡道：只记录不拦截，复盘后可放行）/ 放行
            （自动执行；系统级动态防护与循环防护仍然生效）。保存后立即生效，重启不丢失。
          </p>
        </div>
      </div>

      {error && <p className="petri-field__result petri-field__result--err">{error}</p>}
      {notice && <p className="petri-field__result petri-field__result--ok">{notice}</p>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <select
          value={matcherType}
          onChange={(e) => setMatcherType(e.target.value as 'path-glob' | 'command-token')}
          className="petri-input"
          style={{ width: 140 }}
          aria-label="匹配器类型"
        >
          <option value="path-glob">路径 glob</option>
          <option value="command-token">命令首 token</option>
        </select>
        <input
          type="text"
          className="petri-input"
          style={{ flex: 1, minWidth: 180 }}
          placeholder={matcherType === 'path-glob' ? '如 secrets/** 或 results/*.csv' : '如 npm、curl'}
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          aria-label="匹配模式"
        />
        <select
          value={action}
          onChange={(e) => setAction(e.target.value as RuleAction)}
          className="petri-input"
          style={{ width: 110 }}
          aria-label="动作"
        >
          <option value="require-ack">需确认</option>
          <option value="deny">拒绝</option>
          <option value="observe">观察</option>
          <option value="allow">放行</option>
        </select>
        <input
          type="text"
          className="petri-input"
          style={{ width: 160 }}
          placeholder="备注（可选）"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label="备注"
        />
        <button type="button" className="petri-btn petri-btn--primary petri-btn--sm" onClick={() => void addRule()}>
          添加规则
        </button>
      </div>

      {rules && rules.length > 0 ? (
        <div style={{ display: 'grid', gap: 6 }}>
          {rules.map((rule) => (
            <div
              key={rule.id}
              data-testid={`agent-rule-${rule.id}`}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: '1px solid var(--petri-border, rgba(128,128,128,0.25))', borderRadius: 6 }}
            >
              <span
                className="petri-btn petri-btn--sm"
                style={{ pointerEvents: 'none', opacity: rule.action === 'deny' ? 1 : 0.75 }}
              >
                {ACTION_LABELS[rule.action]}
              </span>
              <code style={{ flex: 1, fontSize: 'var(--petri-font-size-sm)' }}>
                {rule.matcher.type === 'path-glob' ? '路径' : '命令'}: {rule.matcher.pattern}
                {rule.note ? ` · ${rule.note}` : ''}
              </code>
              <button
                type="button"
                className="petri-btn petri-btn--danger-ghost petri-btn--sm"
                onClick={() => void removeRule(rule.id)}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="petri-field__hint">暂无规则——Agent 工具调用按默认审批档位执行。</p>
      )}

      {/* BLOCK-323 放权坡道 — 复盘区：待复盘观察 + 近期自动放行 + 授权变更留痕 */}
      <div data-testid="agent-rule-observations" style={{ marginTop: 14, borderTop: '1px solid var(--petri-border, rgba(128,128,128,0.25))', paddingTop: 10 }}>
        <strong style={{ fontSize: 'var(--petri-font-size-sm)' }}>放权坡道 · 待复盘</strong>
        <p className="petri-field__hint">
          「观察」档命中的调用记录——它们本可自动执行但被观察档拦下证据。复盘后可升级为放行（不再询问）、
          收权为需确认，或仅标记已复盘。
        </p>
        {unreviewed.length > 0 ? (
          <div style={{ display: 'grid', gap: 6 }}>
            {unreviewed.map((row) => (
              <div
                key={row.id}
                data-testid={`agent-rule-observation-${row.id}`}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: '1px dashed var(--petri-border, rgba(128,128,128,0.35))', borderRadius: 6, flexWrap: 'wrap' }}
              >
                <code style={{ flex: 1, minWidth: 220, fontSize: 'var(--petri-font-size-sm)' }}>
                  {row.kind === 'rule-observe' ? `规则「${row.ruleId}」` : `工具「${row.toolName}」`}
                  {' · '}命中 {row.hits} 次 · 最近 {shortTime(row.lastSeenAt)}
                  {row.samplePreview ? (
                    <span style={{ display: 'block', opacity: 0.75 }}>{shortPreview(row.samplePreview)}</span>
                  ) : null}
                </code>
                {row.kind === 'rule-observe' && row.ruleId ? (
                  <>
                    <button
                      type="button"
                      data-testid={`observation-upgrade-${row.id}`}
                      className="petri-btn petri-btn--primary petri-btn--sm"
                      onClick={() => void setRuleAction(row.ruleId as string, 'allow')}
                    >
                      升级为放行
                    </button>
                    <button
                      type="button"
                      className="petri-btn petri-btn--sm"
                      onClick={() => void setRuleAction(row.ruleId as string, 'require-ack')}
                    >
                      收权为需确认
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  data-testid={`observation-review-${row.id}`}
                  className="petri-btn petri-btn--sm"
                  onClick={() => void markReviewed([row.id])}
                >
                  标为已复盘
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="petri-field__hint" data-testid="agent-rule-observations-empty">暂无待复盘观察。</p>
        )}

        {autoAllow.length > 0 ? (
          <div style={{ marginTop: 10 }}>
            <strong style={{ fontSize: 'var(--petri-font-size-sm)' }}>近期自动放行（审计）</strong>
            <div style={{ display: 'grid', gap: 4, marginTop: 4 }} data-testid="agent-rule-auto-allow-list">
              {autoAllow.map((row) => (
                <code key={row.id} style={{ fontSize: 'var(--petri-font-size-sm)' }}>
                  规则「{row.ruleId}」· {row.toolName} · {row.hits} 次 · 最近 {shortTime(row.lastSeenAt)}
                </code>
              ))}
            </div>
          </div>
        ) : null}

        {policyChanges.length > 0 ? (
          <div style={{ marginTop: 10 }}>
            <strong style={{ fontSize: 'var(--petri-font-size-sm)' }}>授权面变更留痕</strong>
            <div style={{ display: 'grid', gap: 4, marginTop: 4 }} data-testid="agent-rule-policy-changes">
              {policyChanges.map((row) => (
                <code key={row.id} style={{ fontSize: 'var(--petri-font-size-sm)', opacity: 0.85 }}>
                  {shortTime(row.lastSeenAt)} · {shortPreview(row.samplePreview)}
                </code>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
