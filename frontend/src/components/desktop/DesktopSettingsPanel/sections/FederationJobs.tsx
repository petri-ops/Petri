/**
 * FederationJobs — BLOCK-346 T4 接线（联邦作业级通道）。
 *
 * 现状补口：后端三端点早已齐全（`POST/GET /api/federation/peers/:id/jobs[/:jobId]`
 * + `GET .../jobs/:jobId/file/:filename`），但前端全文零 `/jobs` 调用 —— 「把作业
 * 发到对端执行并取回产物」只能靠 curl。
 *
 * 语义边界：任务真值在**对端**，本机只做转发与展示；本面板不缓存状态、不轮询，
 * 用户点「查状态」才取（避免对端会话被本机轮询打满）。
 */

import React, { useCallback, useMemo, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

interface PeerOption {
  peerId: string;
  name?: string;
  online?: boolean;
}

function authHeaders(json = false): Record<string, string> {
  const out: Record<string, string> = {};
  if (json) out['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) out.Authorization = `Bearer ${token}`;
  return out;
}

export function FederationJobs({ peers }: { peers: PeerOption[] | null }): React.ReactElement {
  const [peerId, setPeerId] = useState('');
  const [toolId, setToolId] = useState('');
  const [paramsText, setParamsText] = useState('{}');
  const [jobId, setJobId] = useState('');
  const [jobJson, setJobJson] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const options = useMemo(() => peers || [], [peers]);
  const effectivePeer = peerId || options[0]?.peerId || '';

  const submit = useCallback(async () => {
    setBusy(true); setError(null); setNotice(null); setJobJson('');
    try {
      if (!effectivePeer) throw new Error('先选择一个协作节点');
      if (!toolId.trim()) throw new Error('填写对端工具 id（如 deseq2）');
      let params: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(paramsText || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('参数必须是 JSON 对象');
        params = parsed as Record<string, unknown>;
      } catch (e) {
        throw new Error(`参数 JSON 无效：${e instanceof Error ? e.message : String(e)}`);
      }
      const response = await fetch(
        `${getPlatformApiPrefix()}/federation/peers/${encodeURIComponent(effectivePeer)}/jobs`,
        { method: 'POST', headers: authHeaders(true), body: JSON.stringify({ toolId: toolId.trim(), ...params }) },
      );
      const body: unknown = await response.json();
      const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
      if (!response.ok || record.ok !== true) {
        const code = typeof record.error === 'string' ? record.error : `HTTP ${response.status}`;
        const detail = typeof record.message === 'string' ? `：${record.message}` : '';
        throw new Error(`${code}${detail}`);
      }
      const job = record.job as Record<string, unknown> | undefined;
      setJobJson(JSON.stringify(job ?? record, null, 2));
      const id = job && typeof job.id === 'string' ? job.id : (job && typeof job.jobId === 'string' ? job.jobId : '');
      if (id) setJobId(id);
      const peerLabel = typeof record.peerName === 'string' && record.peerName
        ? record.peerName
        : (typeof record.peerId === 'string' && record.peerId ? record.peerId : effectivePeer);
      setNotice(`已提交到 ${peerLabel}${id ? `（job ${id}）` : ''}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败');
    } finally {
      setBusy(false);
    }
  }, [effectivePeer, paramsText, toolId]);

  const refreshStatus = useCallback(async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      if (!effectivePeer || !jobId.trim()) throw new Error('需要节点 + job id');
      const response = await fetch(
        `${getPlatformApiPrefix()}/federation/peers/${encodeURIComponent(effectivePeer)}/jobs/${encodeURIComponent(jobId.trim())}`,
        { headers: authHeaders() },
      );
      const body: unknown = await response.json();
      const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
      if (!response.ok || record.ok !== true) {
        const code = typeof record.error === 'string' ? record.error : `HTTP ${response.status}`;
        throw new Error(code);
      }
      setJobJson(JSON.stringify(record.job ?? record, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : '查询失败');
    } finally {
      setBusy(false);
    }
  }, [effectivePeer, jobId]);

  const downloadUrl = (effectivePeer && jobId.trim() && fileName.trim())
    ? `${getPlatformApiPrefix()}/federation/peers/${encodeURIComponent(effectivePeer)}/jobs/${encodeURIComponent(jobId.trim())}/file/${encodeURIComponent(fileName.trim())}`
    : '';

  return (
    <div className="petri-data-section" data-testid="federation-jobs">
      <label className="petri-field__label">对端作业（作业级联邦）</label>
      <p className="petri-field__hint">
        把一次工具作业转发到协作节点执行；任务真值在对端，本机只转发与查看。不自动轮询。
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <select
          className="petri-input"
          data-testid="federation-job-peer"
          value={effectivePeer}
          onChange={(e) => setPeerId(e.target.value)}
          style={{ maxWidth: 220 }}
        >
          {options.length === 0 && <option value="">（暂无协作节点）</option>}
          {options.map((peer) => (
            <option key={peer.peerId} value={peer.peerId}>
              {peer.name || peer.peerId}{peer.online === false ? '（离线）' : ''}
            </option>
          ))}
        </select>
        <input
          className="petri-input"
          data-testid="federation-job-tool"
          placeholder="对端工具 id（如 deseq2）"
          value={toolId}
          onChange={(e) => setToolId(e.target.value)}
          style={{ maxWidth: 220 }}
        />
        <button
          type="button"
          className="petri-btn petri-btn--ghost petri-btn--sm"
          data-testid="federation-job-submit"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? '提交中…' : '提交作业'}
        </button>
      </div>
      <textarea
        className="petri-input"
        data-testid="federation-job-params"
        rows={3}
        spellCheck={false}
        placeholder='作业参数（JSON 对象，如 {"inputPath":"data/counts.csv"}）'
        value={paramsText}
        onChange={(e) => setParamsText(e.target.value)}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <input
          className="petri-input"
          data-testid="federation-job-id"
          placeholder="对端 job id"
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
          style={{ maxWidth: 220 }}
        />
        <button
          type="button"
          className="petri-btn petri-btn--ghost petri-btn--sm"
          data-testid="federation-job-status"
          disabled={busy}
          onClick={() => void refreshStatus()}
        >
          查状态
        </button>
        <input
          className="petri-input"
          data-testid="federation-job-file"
          placeholder="产物文件名"
          value={fileName}
          onChange={(e) => setFileName(e.target.value)}
          style={{ maxWidth: 200 }}
        />
        {downloadUrl
          ? <a href={downloadUrl} data-testid="federation-job-download" className="petri-btn petri-btn--ghost petri-btn--sm">下载产物</a>
          : <span className="petri-field__hint">填 job id + 文件名后可下载</span>}
      </div>
      {notice && <p className="petri-field__hint" data-testid="federation-job-notice">{notice}</p>}
      {error && <p className="petri-field__hint" role="alert" data-testid="federation-job-error">{error}</p>}
      {jobJson && (
        <pre className="petri-field__hint" data-testid="federation-job-result" style={{ maxHeight: 220, overflow: 'auto' }}>
          {jobJson.slice(0, 4000)}
        </pre>
      )}
    </div>
  );
}
