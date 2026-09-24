import React from 'react';
import { Icon } from '@/components/icons/Icon';
import {
  buildFirstAnalysisPrompt,
  deriveDataReadiness,
  importProjectData,
  primaryFileRole,
  type ImportedDataFile,
} from '@/lib/data-profile';
import { gewuEvents, dispatchGewuEvent } from '@/lib/events';
import styles from '@/pages/project-workspace.module.css';

const ROLE_LABELS: Record<string, string> = {
  counts_matrix: '计数矩阵候选',
  expression_matrix: '表达矩阵候选',
  sample_metadata: '样本信息候选',
};

export function DataIntakeControl({
  projectId,
  onAskAgent,
}: {
  projectId: string;
  onAskAgent: (prompt: string) => boolean | void;
}): React.ReactElement {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const importControllerRef = React.useRef<AbortController | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const popoverRef = React.useRef<HTMLElement>(null);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [imported, setImported] = React.useState<ImportedDataFile[]>([]);
  const readiness = React.useMemo(() => deriveDataReadiness(imported), [imported]);

  const closeIntake = React.useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Move focus into the popover when it opens.
  React.useEffect(() => {
    if (open) popoverRef.current?.focus();
  }, [open]);

  React.useEffect(() => {
    importControllerRef.current?.abort();
    importControllerRef.current = null;
    setBusy(false);
    setImported([]);
    setError('');
    setOpen(false);
    return () => importControllerRef.current?.abort();
  }, [projectId]);

  const chooseFiles = React.useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleFiles = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length === 0) return;
    importControllerRef.current?.abort();
    const controller = new AbortController();
    importControllerRef.current = controller;
    setBusy(true);
    setError('');
    setOpen(true);
    try {
      const next = await importProjectData(projectId, files, controller.signal);
      if (controller.signal.aborted || importControllerRef.current !== controller) return;
      setImported(next);
      dispatchGewuEvent(gewuEvents.projectWorkspaceChanged, {
        projectId,
        source: 'manual',
      });
    } catch (cause) {
      if (controller.signal.aborted || importControllerRef.current !== controller) return;
      setImported([]);
      setError(cause instanceof Error ? cause.message : '导入失败');
    } finally {
      if (importControllerRef.current === controller) {
        importControllerRef.current = null;
        setBusy(false);
      }
    }
  }, [projectId]);

  const startAnalysis = React.useCallback(() => {
    if (readiness.status !== 'ready') return;
    const accepted = onAskAgent(buildFirstAnalysisPrompt(readiness));
    if (accepted === false) {
      setError('当前 Agent 仍在处理上一个请求');
      return;
    }
    closeIntake();
  }, [onAskAgent, readiness, closeIntake]);

  return (
    <div className={styles.dataIntakeControl}>
      <input
        ref={inputRef}
        className={styles.dataIntakeInput}
        type="file"
        accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
        multiple
        onChange={(e) => void handleFiles(e)}
      />
      <button
        ref={triggerRef}
        type="button"
        className={styles.workspaceTreeToggle}
        aria-label="导入数据"
        title="导入数据"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="plus" size={15} />
      </button>
      {open && (
        <section
          ref={popoverRef}
          className={styles.dataIntakePopover}
          aria-label="数据准备"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              closeIntake();
            }
          }}
        >
          <header className={styles.dataIntakeHeader}>
            <strong>数据准备</strong>
            <button className="gewu-btn gewu-btn--icon" type="button" onClick={closeIntake} aria-label="关闭">
              <Icon name="x" size={13} />
            </button>
          </header>

          {busy ? (
            <div className={styles.dataIntakeState} aria-live="polite">
              <span className={styles.dataIntakeSpinner} />
              正在导入并检查…
            </div>
          ) : imported.length === 0 ? (
            <button type="button" className={styles.dataIntakeChoose} onClick={chooseFiles}>
              <Icon name="plus" size={14} />
              选择数据文件
            </button>
          ) : (
            <>
              <div className={styles.dataIntakeFiles}>
                {imported.map((file) => {
                  const role = primaryFileRole(file);
                  const blocked = file.profile.blocked;
                  return (
                    <div key={`${file.relativePath}:${file.profile.snapshot.sha256}`} className={styles.dataIntakeFileRow} data-blocked={blocked || undefined}>
                      <Icon name={blocked ? 'flag' : 'file'} size={14} />
                      <span>
                        <strong title={file.relativePath}>{file.name}</strong>
                        <small>
                          {blocked
                            ? (file.profile.diagnostics.find((item) => item.severity === 'blocked')?.message || '需要处理')
                            : `${ROLE_LABELS[role?.candidate || ''] || '结构候选'} · ${file.profile.observation.totalRowCount} × ${file.profile.observation.columnBounds.observed}`}
                        </small>
                      </span>
                      {!blocked && role && <em>{Math.round(role.confidence * 100)}%</em>}
                    </div>
                  );
                })}
              </div>

              <div className={styles.dataIntakeReadiness} data-status={readiness.status}>
                <Icon name={readiness.status === 'ready' ? 'check' : 'flag'} size={13} />
                <span>{readiness.status === 'ready' ? '可开始分析' : readiness.reasons[0]}</span>
              </div>

              <footer className={styles.dataIntakeActions}>
                <button type="button" className={styles.dataIntakeSecondary} onClick={chooseFiles}>
                  重新选择
                </button>
                <button
                  type="button"
                  className={styles.dataIntakePrimary}
                  disabled={readiness.status !== 'ready'}
                  onClick={startAnalysis}
                >
                  <Icon name="sparkles" size={14} />
                  开始分析
                </button>
              </footer>
            </>
          )}
          {error && <div className={styles.dataIntakeError} role="alert">{error}</div>}
        </section>
      )}
    </div>
  );
}
