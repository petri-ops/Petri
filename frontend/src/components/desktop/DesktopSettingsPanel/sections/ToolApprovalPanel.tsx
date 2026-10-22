import React, { useEffect, useMemo, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

type ToolMode = 'allow' | 'ask' | 'deny';

interface ToolPolicyTool {
  name: string;
  description?: string;
  category?: string | null;
  sideEffect?: string | null;
  riskTier?: string | null;
}

interface ToolPolicyResponse {
  status: string;
  modes?: Record<string, ToolMode>;
  tools?: ToolPolicyTool[];
  error?: string;
  diagnostics?: Array<{ code: string }>;
}

function authHeaders(contentType?: string): Record<string, string> {
  const token = getToken();
  return {
    ...(contentType ? { 'content-type': contentType } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * ToolApprovalPanel — BLOCK-244 Q1-REM A1/A8。
 *
 * 逐工具 allow/ask/deny：
 * - allow（默认）保持历史行为；
 * - ask 走既有审批资源/guardKey 通道（tool:<name>）；
 * - deny 直接拦截。
 * 只把非 allow 的模式落盘；读侧坏文件 fail-soft 为空策略。
 */
export function ToolApprovalPanel(): React.ReactElement {
  const [tools, setTools] = useState<ToolPolicyTool[]>([]);
  const [modes, setModes] = useState<Record<string, ToolMode>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    void fetch(`${getPlatformApiPrefix()}/ai/tool-approval-policy`, { headers: authHeaders() })
      .then(async (response) => {
        const data = (await response.json()) as ToolPolicyResponse;
        if (!response.ok || data?.status !== 'ok') throw new Error(data?.error || '工具策略读取失败');
        if (!cancelled) {
          setTools(Array.isArray(data.tools) ? data.tools : []);
          setModes(data.modes && typeof data.modes === 'object' ? data.modes : {});
          setError('');
          setLoading(false);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return tools;
    return tools.filter((tool) => (
      tool.name.toLowerCase().includes(query)
      || String(tool.description || '').toLowerCase().includes(query)
    ));
  }, [search, tools]);

  const updateMode = (name: string, mode: ToolMode) => {
    setModes((current) => ({ ...current, [name]: mode }));
    setNotice('');
  };

  const save = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload = Object.entries(modes)
        .filter(([, mode]) => mode !== 'allow')
        .map(([name, mode]) => ({ name, mode }));
      const response = await fetch(`${getPlatformApiPrefix()}/ai/tool-approval-policy`, {
        method: 'PUT',
        headers: authHeaders('application/json'),
        body: JSON.stringify({ modes: payload }),
      });
      const data = (await response.json()) as ToolPolicyResponse & { count?: number };
      if (!response.ok || data?.status !== 'ok') {
        const details = (data.diagnostics || []).map((d) => d.code).join('、');
        throw new Error(`${data?.error || '工具策略保存失败'}${details ? `（${details}）` : ''}`);
      }
      setNotice(`工具策略已保存（${data.count ?? payload.length} 条非默认模式，立即生效）`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="petri-usage-resource" data-testid="tool-approval-panel">
      <div className="petri-resource-heading">
        <div>
          <strong>工具审批策略</strong>
          <p>
            逐工具设置 allow / ask / deny。allow 保持默认；ask 每次调用弹审批卡（仅本次/本任务，复用统一审批通道）；
            deny 直接拦截。保存后立即生效；MCP 服务级 trust 与逐工具 enabled 仍在扩展页治理。
          </p>
        </div>
      </div>

      {error && <p className="petri-field__result petri-field__result--err">{error}</p>}
      {notice && <p className="petri-field__result petri-field__result--ok" data-testid="tool-approval-notice">{notice}</p>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <input
          type="text"
          className="petri-input"
          style={{ flex: 1, minWidth: 200 }}
          placeholder="搜索工具名或描述"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="搜索工具"
          data-testid="tool-approval-search"
        />
        <button
          type="button"
          className="petri-btn petri-btn--primary petri-btn--sm"
          disabled={saving || loading}
          onClick={() => void save()}
          data-testid="tool-approval-save"
        >
          {saving ? '保存中…' : '保存策略'}
        </button>
      </div>

      {loading ? (
        <p className="petri-field__hint">工具清单加载中…</p>
      ) : filtered.length === 0 ? (
        <p className="petri-field__hint">没有匹配的工具。</p>
      ) : (
        <div style={{ display: 'grid', gap: 6, maxHeight: 360, overflow: 'auto' }}>
          {filtered.map((tool) => (
            <div
              key={tool.name}
              data-testid={`tool-approval-row-${tool.name}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                border: '1px solid var(--petri-border, rgba(128,128,128,0.25))',
                borderRadius: 6,
                minWidth: 0,
              }}
            >
              <code style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }} title={tool.description || tool.name}>
                {tool.name}
                {tool.sideEffect && tool.sideEffect !== 'none' ? ` · ${tool.sideEffect}` : ''}
                {tool.riskTier ? ` · ${tool.riskTier}` : ''}
              </code>
              <select
                className="petri-input"
                style={{ width: 96 }}
                value={modes[tool.name] || 'allow'}
                onChange={(event) => updateMode(tool.name, event.target.value as ToolMode)}
                aria-label={`${tool.name} 审批模式`}
                data-testid={`tool-approval-mode-${tool.name}`}
              >
                <option value="allow">allow</option>
                <option value="ask">ask</option>
                <option value="deny">deny</option>
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
