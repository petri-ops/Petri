/**
 * CopilotResultPanel.tsx — agent-led 阶段2 Task2：Copilot 内嵌结果面板。
 *
 * 订阅 copilotContext.activeResultJobId，fetch /tools/status/:id 拿 result，
 * 内联渲染图列表（点击 lightbox）+ 数据文件下载。用户不用离开 Copilot 看结果。
 *
 * 替代阶段1 的 open_result 跳 /tools 页方案（sessionStorage + window.location.href）。
 * 依赖 getApiPrefix（web/桌面各一份），故组件本身不进共享包。
 */
import React, { useEffect, useState } from 'react';
import { getApiPrefix, getToken } from '@/lib/authClient';
import { subscribeCopilotContext, getCopilotContext } from './copilotContext';

interface ResultFile {
  name: string;
  type?: string;
  label?: string;
  path?: string;
}
interface ToolJobResult {
  ok?: boolean;
  toolId?: string;
  status?: string;
  error?: string;
  result?: {
    outputs?: ResultFile[];
    files?: string[];
    summary?: Record<string, unknown>;
  };
}

function buildUrl(jobId: string, name: string): string {
  const base = getApiPrefix();
  const token = getToken();
  const q = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${base}/tools/file/${encodeURIComponent(jobId)}/${encodeURIComponent(name)}${q}`;
}

export function CopilotResultPanel() {
  const [jobId, setJobId] = useState<string | undefined>(getCopilotContext().activeResultJobId);
  const [result, setResult] = useState<ToolJobResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);

  // 订阅 copilotContext.activeResultJobId 变化
  useEffect(() => {
    const unsub = subscribeCopilotContext((c) => {
      if (c.activeResultJobId && c.activeResultJobId !== jobId) {
        setJobId(c.activeResultJobId);
        setClosed(false);
      }
    });
    return unsub;
  }, [jobId]);

  // fetch 结果
  useEffect(() => {
    if (!jobId || closed) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const token = getToken();
        const resp = await fetch(`${getApiPrefix()}/tools/status/${encodeURIComponent(jobId)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = (await resp.json()) as ToolJobResult;
        if (!cancelled) {
          setResult(data);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setResult(null);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, closed]);

  if (!jobId || closed) return null;

  // 收集图文件：result.outputs（带 type）优先，回退 result.files（仅文件名）
  const outputs = result?.result?.outputs || [];
  const files = result?.result?.files || [];
  const plots = outputs.filter(
    (o) => o.type === 'plot' || /\.(png|pdf|jpg|jpeg|svg)$/i.test(o.name)
  );
  const plotFiles =
    plots.length > 0
      ? plots
      : files
          .filter((f) => /\.(png|jpg|jpeg|svg)$/i.test(f))
          .map((f) => ({ name: f, type: 'plot' }));
  const dataFiles = outputs.filter((o) => o.type !== 'plot').map((o) => ({ ...o }));
  const summary = result?.result?.summary;

  return (
    <div className="cp-result-panel">
      <div className="cp-result-header">
        <span className="cp-result-title">
          {loading ? '加载结果…' : result?.error ? `结果加载失败: ${result.error}` : '分析结果'}
        </span>
        <button className="cp-result-close" onClick={() => setClosed(true)} title="关闭结果面板">
          ×
        </button>
      </div>

      {!loading && result?.ok && (
        <>
          {summary && Object.keys(summary).length > 0 && (
            <div className="cp-result-summary">
              {Object.entries(summary).map(([k, v]) => (
                <div key={k} className="cp-result-stat">
                  <span className="cp-result-stat-value">{String(v)}</span>
                  <span className="cp-result-stat-label">{k}</span>
                </div>
              ))}
            </div>
          )}

          {plotFiles.length > 0 && (
            <div className="cp-result-plots">
              {plotFiles.map((f, i) => {
                const url = buildUrl(jobId, f.name);
                return (
                  <div key={f.name} className="cp-result-plot">
                    <img src={url} alt={f.label || f.name} onClick={() => setLightboxSrc(url)} />
                    <div className="cp-result-plot-label">
                      图{i + 1}: {f.label || f.name.replace(/\.\w+$/, '')}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {dataFiles.length > 0 && (
            <div className="cp-result-files">
              {dataFiles.map((f) => (
                <a key={f.name} href={buildUrl(jobId, f.name)} download className="cp-result-file">
                  📄 {f.label || f.name}
                </a>
              ))}
            </div>
          )}
        </>
      )}

      {lightboxSrc && (
        <div className="cp-result-lightbox" onClick={() => setLightboxSrc(null)}>
          <img src={lightboxSrc} alt="放大" />
          <button className="cp-result-lightbox-close" onClick={() => setLightboxSrc(null)}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
