// ============================================================
// DesktopSettingsPanel — Agent 用户规则面板（BLOCK-160 W2 P2/ORC-1）
//
// 规则列表式增删改：匹配器（path-glob / command-token）+ 动作（deny /
// require-ack）+ 作用域（global）。数据源 = /api/ai/agent-rules CRUD，
// 持久化 = $BIOF3_LOCAL_DATA_DIR/agent-rules.json（拦截器缓存读取，
// 重启不敏感——helper mtime 缓存 3s 内自愈）。语义：first-match 先到先判；
// require-ack = 拦截并要求确认（确认 UI 为后续 rider，当前经 ack 通道）。
// ============================================================

import React, { useEffect, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

interface AgentRule {
  id: string;
  matcher: { type: 'path-glob' | 'command-token'; pattern: string };
  action: 'deny' | 'require-ack';
  scope: 'global';
  note?: string;
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

export function AgentRulesPanel(): React.ReactElement {
  const [rules, setRules] = useState<AgentRule[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [matcherType, setMatcherType] = useState<'path-glob' | 'command-token'>('path-glob');
  const [pattern, setPattern] = useState('');
  const [action, setAction] = useState<'deny' | 'require-ack'>('require-ack');
  const [note, setNote] = useState('');

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
    return () => {
      cancelled = true;
    };
  }, []);

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

  return (
    <div className="gewu-usage-resource">
      <div className="gewu-resource-heading">
        <div>
          <strong>Agent 用户规则</strong>
          <p>
            工具调用拦截规则（first-match 先到先判）：路径 glob（如 secrets/**、results/**）或命令首 token
            （如 npm、curl）→ 拒绝 / 需确认。保存后立即生效，重启不丢失。
          </p>
        </div>
      </div>

      {error && <p className="gewu-field__result gewu-field__result--err">{error}</p>}
      {notice && <p className="gewu-field__result gewu-field__result--ok">{notice}</p>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <select
          value={matcherType}
          onChange={(e) => setMatcherType(e.target.value as 'path-glob' | 'command-token')}
          className="gewu-input"
          style={{ width: 140 }}
          aria-label="匹配器类型"
        >
          <option value="path-glob">路径 glob</option>
          <option value="command-token">命令首 token</option>
        </select>
        <input
          type="text"
          className="gewu-input"
          style={{ flex: 1, minWidth: 180 }}
          placeholder={matcherType === 'path-glob' ? '如 secrets/** 或 results/*.csv' : '如 npm、curl'}
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          aria-label="匹配模式"
        />
        <select
          value={action}
          onChange={(e) => setAction(e.target.value as 'deny' | 'require-ack')}
          className="gewu-input"
          style={{ width: 110 }}
          aria-label="动作"
        >
          <option value="require-ack">需确认</option>
          <option value="deny">拒绝</option>
        </select>
        <input
          type="text"
          className="gewu-input"
          style={{ width: 160 }}
          placeholder="备注（可选）"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label="备注"
        />
        <button type="button" className="gewu-btn gewu-btn--primary gewu-btn--sm" onClick={() => void addRule()}>
          添加规则
        </button>
      </div>

      {rules && rules.length > 0 ? (
        <div style={{ display: 'grid', gap: 6 }}>
          {rules.map((rule) => (
            <div
              key={rule.id}
              data-testid={`agent-rule-${rule.id}`}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: '1px solid var(--gewu-border, rgba(128,128,128,0.25))', borderRadius: 6 }}
            >
              <span
                className="gewu-btn gewu-btn--sm"
                style={{ pointerEvents: 'none', opacity: rule.action === 'deny' ? 1 : 0.7 }}
              >
                {rule.action === 'deny' ? '拒绝' : '需确认'}
              </span>
              <code style={{ flex: 1, fontSize: 'var(--gewu-font-size-caption, 12px)' }}>
                {rule.matcher.type === 'path-glob' ? '路径' : '命令'}: {rule.matcher.pattern}
                {rule.note ? ` · ${rule.note}` : ''}
              </code>
              <button
                type="button"
                className="gewu-btn gewu-btn--danger-ghost gewu-btn--sm"
                onClick={() => void removeRule(rule.id)}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="gewu-field__hint">暂无规则——Agent 工具调用按默认审批档位执行。</p>
      )}
    </div>
  );
}
