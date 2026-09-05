// ============================================================
// WindowResultPage — BLOCK-59 P1 结果窗只读聚焦视图
//
// 路由 /window/result/:artifactId，key = `jobId:artifactName`。
// 编辑/改参留在主窗（plan §4.2 裁决 1：弹出窗一律只读）——本页
// 只做：状态自举（/api/tools/status 语言无关）→ manifest 归一
// → 聚焦产物只读渲染（image / report / table / text），复用
// Result Studio 既有纯函数（normalizeResultManifest /
// resolveResultViewerAdapter / buildPreviewTable）。
// ============================================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { WindowShell } from '@/components/window/WindowShell';
import { getApiPrefix, getToken } from '@/lib/authClient';
import { tools } from '@/tools/inventory';
import { buildPreviewTable } from '@/lib/file-preview/buildPreviewTable';
import { formatPreviewText } from '@/lib/previewFileUtils';
import {
  classifyArtifact,
  findArtifactByName,
  normalizeResultManifest,
  pickPreferredArtifact,
  artifactKindLabel,
  type ResultArtifactRecord,
} from '@/lib/result-manifest';
import { resolveResultViewerAdapter } from '@/components/result-studio/resultSurface';
import type { Tool } from '@/tools/registry';
import styles from '@/components/window/window-shell.module.css';

interface JobStatusPayload {
  ok: boolean;
  id: string;
  toolId: string;
  status: string;
  error?: string | null;
  name?: string | null;
  result?: {
    artifacts?: Array<Record<string, unknown>>;
    files?: Array<Record<string, unknown>>;
    manifest?: unknown;
    deliveryManifest?: { status?: string | null } | null;
  } | null;
}

export function parseWindowKey(raw: string): { jobId: string; artifactName: string } {
  const sep = raw.indexOf(':');
  if (sep <= 0) return { jobId: '', artifactName: '' };
  return { jobId: raw.slice(0, sep), artifactName: raw.slice(sep + 1) };
}

export function WindowResultPage(): React.ReactElement {
  const params = useParams<{ artifactId?: string }>();
  const { jobId, artifactName: requestedName } = parseWindowKey(params.artifactId ?? '');
  const [status, setStatus] = useState<JobStatusPayload | null>(null);
  const [statusError, setStatusError] = useState('');
  const [statusLoading, setStatusLoading] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const [fallbackManifest, setFallbackManifest] = useState<unknown>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<string[][] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const lang: 'r' | 'python' = useMemo(() => {
    const tool: Tool | undefined = tools.find((t) => t.id === status?.toolId);
    return tool?.language === 'python' ? 'python' : 'r';
  }, [status?.toolId]);

  const buildUrl = useCallback(
    (name: string) => {
      const base = getApiPrefix(lang);
      const token = getToken();
      const tokenQs = token ? `?token=${encodeURIComponent(token)}` : '';
      return `${base}/tools/file/${encodeURIComponent(jobId)}/${encodeURIComponent(name)}${tokenQs}`;
    },
    [jobId, lang],
  );

  // 状态自举：/api/tools/status 为语言无关端点，toolId 经静态注册表反推 lang。
  useEffect(() => {
    if (!jobId) {
      setStatusError('窗口键不合法（期望 result:jobId:artifactName）');
      return;
    }
    let cancelled = false;
    setStatusLoading(true);
    setStatusError('');
    (async () => {
      try {
        const token = getToken();
        // /api/tools/status 为语言无关端点；仍走绝对前缀（弹出窗与主窗
        // 同一 preload 桥，backendConfig 可用），不得用相对路径——SPA
        // 服务器不代理 /api。
        const resp = await fetch(`${getApiPrefix('r')}/tools/status/${encodeURIComponent(jobId)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await resp.json().catch(() => null);
        if (cancelled) return;
        if (!resp.ok || !data?.ok) {
          setStatusError(data?.error === 'not_found' ? '任务不存在或已被清理' : `任务状态获取失败（HTTP ${resp.status}）`);
          return;
        }
        setStatus(data as JobStatusPayload);
      } catch (e) {
        if (!cancelled) setStatusError(e instanceof Error ? e.message : '网络错误');
      } finally {
        if (!cancelled) setStatusLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, retryVersion]);

  const files: ResultArtifactRecord[] = useMemo(() => {
    const raw = status?.result?.artifacts || status?.result?.files || [];
    return raw.map((file) => {
      const name = String(file.name ?? file.filename ?? file.path ?? '');
      return {
        name,
        type: String(file.type ?? ''),
        label: (file.label as string) || (file.title as string) || undefined,
        title: (file.title as string) || undefined,
        url: buildUrl(name),
        preview: file.preview as boolean | undefined,
      } as ResultArtifactRecord;
    });
  }, [buildUrl, status]);

  // manifest 缺省时补取 manifest.json（与主窗 ResultView 同款语义）
  useEffect(() => {
    if (!status || (status.result?.manifest && typeof status.result.manifest === 'object')) {
      setFallbackManifest(status?.result?.manifest ?? null);
      return;
    }
    if (files.length === 0) return;
    let cancelled = false;
    fetch(buildUrl('manifest.json'))
      .then((resp) => (resp.ok ? resp.json() : null))
      .then((json) => {
        if (!cancelled) setFallbackManifest(json);
      })
      .catch(() => {
        if (!cancelled) setFallbackManifest(null);
      });
    return () => {
      cancelled = true;
    };
  }, [buildUrl, files.length, status]);

  const manifest = useMemo(() => normalizeResultManifest(fallbackManifest, files), [fallbackManifest, files]);
  const artifacts = manifest?.artifacts?.length ? manifest.artifacts : files;
  const coreArtifacts = useMemo(
    () => artifacts.filter((artifact) => classifyArtifact(artifact) !== 'report'),
    [artifacts],
  );
  const requested = requestedName ? findArtifactByName(artifacts, requestedName) : null;
  const selectedArtifact = requested || pickPreferredArtifact(coreArtifacts, '') || coreArtifacts[0] || artifacts[0] || null;
  const selectedName = selectedArtifact?.name || requestedName;
  const selectedKind = selectedArtifact ? classifyArtifact(selectedArtifact) : 'file';
  const viewerAdapter = selectedArtifact
    ? resolveResultViewerAdapter({ kind: selectedKind, fileName: selectedName, preview: selectedArtifact.preview })
    : 'binary';
  const selectedUrl = selectedArtifact?.url || (selectedName ? buildUrl(selectedName) : '');

  // 文本 / 表格预览拉取（只读，不触交互链）
  useEffect(() => {
    const isTextual = viewerAdapter === 'table' || viewerAdapter === 'text' || viewerAdapter === 'json';
    if (!selectedUrl || !isTextual) {
      setPreviewText(null);
      setPreviewRows(null);
      setPreviewError('');
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError('');
    fetch(selectedUrl)
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.text();
      })
      .then((text) => {
        if (cancelled) return;
        if (viewerAdapter === 'table') {
          setPreviewRows(buildPreviewTable(text, selectedName));
          setPreviewText(null);
        } else if (selectedName.toLowerCase().endsWith('.json')) {
          try {
            setPreviewText(JSON.stringify(JSON.parse(text), null, 2));
          } catch {
            setPreviewText(formatPreviewText(selectedName, text).slice(0, 12000));
          }
        } else {
          setPreviewText(formatPreviewText(selectedName, text).slice(0, 12000));
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setPreviewError(e.message || '产物文件不可读取');
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedName, selectedUrl, viewerAdapter]);

  const jobTitle = status?.name || jobId || '结果';
  const jobStatus = status?.status || '';
  const body = (() => {
    if (!jobId) {
      return <div className={styles.placeholder}>窗口键不合法：期望 result:jobId:artifactName。</div>;
    }
    if (statusLoading && !status) {
      return <div className={styles.placeholder}>加载任务状态中…</div>;
    }
    if (statusError) {
      return (
        <div className={styles.resultBody}>
          <div className={styles.errorBlock} role="alert">{statusError}</div>
          <button
            type="button"
            className="gewu-btn gewu-btn--ghost gewu-btn--sm"
            onClick={() => setRetryVersion((v) => v + 1)}
          >
            重试
          </button>
        </div>
      );
    }
    if (jobStatus === 'running' || jobStatus === 'pending') {
      return (
        <div className={styles.resultBody}>
          <span className={styles.statusChip} data-status={jobStatus}>
            {jobStatus === 'running' ? '分析运行中…' : '排队中'}
          </span>
          <span className={styles.placeholder}>任务完成后此处展示产物（只读）。</span>
        </div>
      );
    }
    if (jobStatus === 'failed' || jobStatus === 'cancelled') {
      return (
        <div className={styles.resultBody}>
          <span className={styles.statusChip} data-status="failed">任务失败</span>
          {status?.error && <div className={styles.errorBlock}>{status.error}</div>}
        </div>
      );
    }
    if (!selectedArtifact) {
      return (
        <div className={styles.placeholder}>
          {requestedName
            ? `产物「${requestedName}」不在任务 ${jobId} 的结果清单中。`
            : '该任务未生成可视化结果文件。'}
        </div>
      );
    }
    if (!requested && requestedName) {
      return (
        <div className={styles.resultBody}>
          <span className={styles.statusChip}>产物「{requestedName}」不在清单中，已显示推荐产物</span>
          {renderArtifact()}
        </div>
      );
    }
    return renderArtifact();
  })();

  function renderArtifact(): React.ReactElement {
    if (viewerAdapter === 'image' && selectedUrl) {
      return (
        <div className={styles.resultBody}>
          <span className={styles.statusChip}>{artifactKindLabel(selectedKind)} · {selectedName}</span>
          <div className={styles.imageCanvas}>
            <img key={selectedUrl} src={selectedUrl} alt={selectedName} />
          </div>
        </div>
      );
    }
    if (viewerAdapter === 'report' && selectedUrl) {
      return (
        <div className={styles.resultBody}>
          <iframe className={styles.reportFrame} src={selectedUrl} title={selectedName} sandbox="allow-same-origin" />
        </div>
      );
    }
    if (previewLoading) {
      return <div className={styles.placeholder}>加载预览中…</div>;
    }
    if (previewError) {
      return (
        <div className={styles.resultBody}>
          <div className={styles.errorBlock} role="alert">产物文件不可读取：{previewError}</div>
          {selectedUrl && <a className={styles.placeholder} href={selectedUrl} target="_blank" rel="noreferrer">打开或下载原文件</a>}
        </div>
      );
    }
    if (viewerAdapter === 'table' && previewRows && previewRows.length > 0) {
      const [header, ...rows] = previewRows;
      return (
        <div className={styles.resultBody}>
          <span className={styles.statusChip}>{artifactKindLabel(selectedKind)} · {selectedName}</span>
          <table className={styles.previewTable}>
            <thead>
              <tr>{header.map((cell, idx) => <th key={`${cell || 'col'}-${idx}`}>{cell || `列 ${idx + 1}`}</th>)}</tr>
            </thead>
            <tbody>
              {rows.slice(0, 40).map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {header.map((_, cellIndex) => <td key={cellIndex}>{row[cellIndex] || '—'}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    if ((viewerAdapter === 'json' || viewerAdapter === 'text') && previewText) {
      return (
        <div className={styles.resultBody}>
          <span className={styles.statusChip}>{artifactKindLabel(selectedKind)} · {selectedName}</span>
          <pre className={styles.textPreview}>{previewText}</pre>
        </div>
      );
    }
    return (
      <div className={styles.resultBody}>
        <div className={styles.placeholder}>
          <div>当前产物不支持内嵌只读预览（{selectedName || '未命名'}）。</div>
          {selectedUrl && <a href={selectedUrl} target="_blank" rel="noreferrer">打开或下载原文件</a>}
        </div>
      </div>
    );
  }

  return (
    <WindowShell title={jobTitle} subtitle={selectedName || undefined}>
      {body}
    </WindowShell>
  );
}
