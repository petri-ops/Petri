import React from 'react';
import { HighlightedCode } from '@/components/ui/CodeHighlight';
import {
  fetchRevisionSource,
  ResultStudioRequestError,
  type RevisionSourceProjection,
} from './resultStudioClient';
import styles from './RevisionCodeView.module.css';

function scopeLabel(scope: RevisionSourceProjection['scope']): string {
  if (scope === 'artifact_specific_materialization') return '产物独立脚本';
  if (scope === 'job_shared_execution_snapshot') return '共享执行脚本';
  if (scope === 'canonical_plugin_shared') return '插件规范脚本';
  return '脚本来源待确认';
}

export function RevisionCodeView({
  projectId,
  revisionId,
  revisionOrdinal,
  onAgentRequest,
  onOpenWorkspaceFile,
}: {
  projectId: string;
  revisionId: string | null;
  revisionOrdinal?: number | null;
  onAgentRequest?: (request: 'explain' | 'modify' | 'replay') => void;
  onOpenWorkspaceFile?: (relativePath: string) => void;
}): React.ReactElement {
  const [projection, setProjection] = React.useState<RevisionSourceProjection | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<{ code: string; message: string } | null>(null);
  const [actionMessage, setActionMessage] = React.useState('');
  const requestEpoch = React.useRef(0);
  const requestKey = `${projectId}:${revisionId || ''}`;

  const load = React.useCallback((signal?: AbortSignal) => {
    if (!revisionId) {
      setProjection(null);
      setError({ code: 'revision_required', message: '当前结果没有可验证的 Revision 源。' });
      return Promise.resolve();
    }
    const epoch = requestEpoch.current + 1;
    requestEpoch.current = epoch;
    setLoading(true);
    setError(null);
    return fetchRevisionSource(projectId, revisionId, { signal })
      .then((next) => { if (epoch === requestEpoch.current) setProjection(next); })
      .catch((reason: unknown) => {
        if (typeof DOMException !== 'undefined' && reason instanceof DOMException && reason.name === 'AbortError') return;
        if (epoch !== requestEpoch.current) return;
        const typed = reason instanceof ResultStudioRequestError
          ? reason
          : new Error(reason instanceof Error ? reason.message : '无法读取该 Revision 的代码。');
        setProjection(null);
        setError({ code: typed instanceof ResultStudioRequestError ? typed.code : 'revision_source_failed', message: typed.message });
      })
      .finally(() => { if (epoch === requestEpoch.current) setLoading(false); });
  }, [projectId, revisionId]);

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => { controller.abort(); requestEpoch.current += 1; };
  }, [load, requestKey]);

  const copy = async () => {
    if (!projection) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable');
      await navigator.clipboard.writeText(projection.content);
      setActionMessage('已复制完整代码');
    } catch {
      setActionMessage('剪贴板不可用，请使用下载');
    }
  };

  const download = () => {
    if (!projection || typeof URL === 'undefined' || typeof Blob === 'undefined') {
      setActionMessage('当前环境不支持下载');
      return;
    }
    const href = URL.createObjectURL(new Blob([projection.content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = href;
    link.download = projection.entryPoint || 'revision-source.R';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 0);
    setActionMessage('已下载完整代码');
  };

  if (loading) return <section className={styles.surface} aria-busy="true"><p>正在读取当前 Revision 的精确代码…</p></section>;
  if (error || !projection) {
    return (
      <section className={styles.surface} role="alert">
        <strong>代码不可用</strong>
        <p>{error?.message || '当前 Revision 没有可验证的代码投影。'}</p>
        <small>{error?.code || 'revision_source_unavailable'}</small>
        {revisionId && <button type="button" onClick={() => void load()}>重试</button>}
      </section>
    );
  }

  const replayStatus = projection.reproduction.replayable
    ? '输入、参数和运行时摘要可供确认后重放'
    : projection.reproduction.inputDrift.length > 0
      ? '输入发生漂移，已禁用重放'
      : '复现信息不完整，已禁用重放';

  return (
    <section className={styles.surface} data-scope={projection.scope}>
      <header className={styles.header}>
        <div>
          <h3>{projection.entryPoint} · v{revisionOrdinal || projection.revisionOrdinal}</h3>
          <p>{projection.language} · {scopeLabel(projection.scope)} · {projection.reproduction.status}</p>
        </div>
        <div className={styles.actions} aria-label="代码操作">
          <button type="button" onClick={() => void copy()}>复制</button>
          <button type="button" onClick={download}>下载</button>
          <details>
            <summary>交给 Agent</summary>
            <div className={styles.menu}>
              <button type="button" onClick={() => onAgentRequest?.('explain')}>解释这份代码</button>
              <button type="button" onClick={() => onAgentRequest?.('modify')}>提出代码修改</button>
              <button type="button" disabled={!projection.reproduction.replayable} onClick={() => onAgentRequest?.('replay')}>请求受控重放</button>
            </div>
          </details>
        </div>
      </header>
      <div className={styles.status} role="status">
        {actionMessage || replayStatus}
        {projection.openableRelativePath && onOpenWorkspaceFile && (
          <button type="button" onClick={() => onOpenWorkspaceFile(projection.openableRelativePath!)}>在项目文件中打开</button>
        )}
      </div>
      <details className={styles.technical}>
        <summary>技术信息</summary>
        <dl>
          <dt>源码 hash</dt><dd>{projection.sha256}</dd>
          <dt>参数 hash</dt><dd>{projection.parameters?.sha256 || '不可用'}</dd>
          <dt>运行时</dt><dd>{projection.reproduction.runtime.name || '未知'} {projection.reproduction.runtime.version || ''}</dd>
        </dl>
      </details>
      <pre className={styles.code}><HighlightedCode code={projection.content} language={projection.language} /></pre>
    </section>
  );
}
