/**
 * AgentAuditPanel — BLOCK-346 T4 追加（零消费端点接线）。
 *
 * 现状补口：后端三个端点早已就绪但前端零调用 ——
 *   `GET  /api/ai/agent-audit`      最近 50 条 agent 操作审计（含 undo_token）
 *   `POST /api/ai/agent-undo/:token` 撤销一次 agent 操作
 *   `GET|POST /api/ai/agent-settings` agent 暂停开关（agentPaused）
 * 三者合起来才是「agent 做错了能撤回」的闭环，缺 UI 等于用户只能看日志干着急。
 *
 * 边界：撤销由后端 `undoAgentAct` 执行且幂等（已撤销再次点无副作用）；面板只做触发与刷新，
 * 不缓存储结果，失败如实展示后端错误。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

interface AuditItem {
  id: string | number;
  undo_token?: string | null;
  action?: string;
  ts?: string | number | null;
  undone?: boolean | number | null;
}

function headers(json = false): Record<string, string> {
  const out: Record<string, string> = {};
  if (json) out['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) out.Authorization = `Bearer ${token}`;
  return out;
}

function fmtTs(ts: string | number | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? String(ts) : d.toLocaleString();
}

export function AgentAuditPanel(): React.ReactElement {
  const [items, setItems] = useState<AuditItem[] | null>(null);
  const [paused, setPaused] = useState<boolean | null>(null);
  const [busyToken, setBusyToken] = useState<string | null>(null);
  const [busyPause, setBusyPause] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadAudit = useCallback(async () => {
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/ai/agent-audit`, { headers: headers() });
      const body: unknown = await response.json();
      const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
      if (!response.ok || record.status !== 'ok') {
        setError(typeof record.error === 'string' ? record.error : `HTTP ${response.status}`);
        return;
      }
      const raw = Array.isArray(record.items) ? record.items : [];
      setItems(raw.filter((x): x is AuditItem => Boolean(x) && typeof x === 'object'));
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取审计失败');
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/ai/agent-settings`, { headers: headers() });
      const body: unknown = await response.json();
      const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
      if (response.ok && record.status === 'ok') setPaused(record.agentPaused === true);
    } catch {
      /* 读取失败保持未知态，不假装 */
    }
  }, []);

  useEffect(() => {
    // 异步装载（IIFE 包裹，避免同步 setState in effect 的级联渲染告警）
    void (async () => {
      await loadAudit();
      await loadSettings();
    })();
  }, [loadAudit, loadSettings]);

  const togglePause = useCallback(async (next: boolean) => {
    setBusyPause(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/ai/agent-settings`, {
        method: 'POST',
        headers: headers(true),
        body: JSON.stringify({ agentPaused: next }),
      });
      const body: unknown = await response.json();
      const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
      if (!response.ok || record.status !== 'ok') {
        setError(typeof record.error === 'string' ? record.error : `HTTP ${response.status}`);
        return;
      }
      setPaused(record.agentPaused === true);
      setNotice(next ? '已暂停 agent（新任务不再启动；运行中的任务不受影响）' : '已恢复 agent');
    } catch (e) {
      setError(e instanceof Error ? e.message : '切换失败');
    } finally {
      setBusyPause(false);
    }
  }, []);

  const undo = useCallback(async (token: string) => {
    setBusyToken(token); setError(null); setNotice(null);
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/ai/agent-undo/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: headers(true),
      });
      const body: unknown = await response.json();
      const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
      if (!response.ok || record.status !== 'ok') {
        setError(typeof record.error === 'string' ? record.error : `撤销失败（HTTP ${response.status}）`);
        return;
      }
      setNotice('已撤销该操作');
      await loadAudit();
    } catch (e) {
      setError(e instanceof Error ? e.message : '撤销失败');
    } finally {
      setBusyToken(null);
    }
  }, [loadAudit]);

  return (
    <div className="petri-field" data-testid="agent-audit-panel">
      <label className="petri-field__label">Agent 操作审计与撤销</label>
      <p className="petri-field__hint">
        最近 50 次 agent 触发的可撤销操作；撤销由后端执行且幂等，已撤销项可重复点击。
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="petri-btn petri-btn--ghost petri-btn--sm"
          data-testid="agent-audit-refresh"
          onClick={() => void loadAudit()}
        >
          刷新
        </button>
        <button
          type="button"
          className={`petri-btn petri-btn--ghost petri-btn--sm${paused ? ' petri-btn--active' : ''}`}
          data-testid="agent-pause-toggle"
          disabled={busyPause || paused === null}
          onClick={() => void togglePause(!paused)}
        >
          {paused === null ? '暂停状态未知' : (paused ? '已暂停 · 点击恢复' : '暂停 agent')}
        </button>
        {notice && <span className="petri-field__hint" data-testid="agent-audit-notice">{notice}</span>}
      </div>
      {error && <p className="petri-field__hint" role="alert" data-testid="agent-audit-error">{error}</p>}
      {items && items.length === 0 && <p className="petri-field__hint">还没有可撤销的 agent 操作。</p>}
      {items && items.length > 0 && (
        <ul className="petri-field__hint" data-testid="agent-audit-list" style={{ margin: '6px 0 0 16px', padding: 0 }}>
          {items.map((item) => {
            const token = typeof item.undo_token === 'string' ? item.undo_token : '';
            const undone = item.undone === true || item.undone === 1;
            return (
              <li key={String(item.id)} style={{ marginBottom: 4 }}>
                <code>{item.action || '未知动作'}</code>
                {' · '}
                {fmtTs(item.ts)}
                {undone ? (
                  <span> · 已撤销</span>
                ) : token ? (
                  <button
                    type="button"
                    className="petri-btn petri-btn--ghost petri-btn--sm"
                    data-testid={`agent-undo-${token}`}
                    disabled={busyToken === token}
                    onClick={() => void undo(token)}
                    style={{ marginLeft: 8 }}
                  >
                    {busyToken === token ? '撤销中…' : '撤销'}
                  </button>
                ) : (
                  <span> · 不可撤销</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
