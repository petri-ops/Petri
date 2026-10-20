import React from 'react';
import { Icon } from '@/components/icons/Icon';
import { getApiPrefix } from '@/lib/authClient';
import { getBridge } from '@/lib/desktopBridge';
import type { Project } from '@/lib/project-types';
import type { ActiveWorkspaceFile } from '@/pages/project-workspace/types';
import {
  hydrateConversationFileChanges,
  useConversationFileChanges,
} from '@/components/copilot/conversationChangesStore';
import { useConversationRun } from '@/components/copilot/conversationRunStore';
import {
  resolveGeneratedFileSource,
  resolveGeneratedFilesPanelState,
} from '@/lib/workSurface/generatedFileSource';
import styles from './WorkSurfacePanels.module.css';

export function GeneratedFilesSurface({
  project,
  conversationId,
  onOpenFile,
  onAskAgent,
}: {
  project: Project;
  conversationId: string | null;
  onOpenFile: (file: ActiveWorkspaceFile) => void;
  onAskAgent?: (prompt: string) => void;
}): React.ReactElement {
  const changes = useConversationFileChanges(conversationId);
  const run = useConversationRun(conversationId);
  const [hydration, setHydration] = React.useState<{ conv: string | null; loading: boolean; error: string | null }>(
    { conv: conversationId, loading: Boolean(conversationId), error: null }
  );
  const [knownConv, setKnownConv] = React.useState(conversationId);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [actionNotice, setActionNotice] = React.useState('');

  // React 官方「props 变化即调整 state」渲染期模式：避免 effect 内同步 setState。
  if (knownConv !== conversationId) {
    setKnownConv(conversationId);
    setHydration({ conv: conversationId, loading: Boolean(conversationId), error: null });
  }

  React.useEffect(() => {
    if (!conversationId) return undefined;
    let alive = true;
    hydrateConversationFileChanges(conversationId)
      .then(() => {
        if (alive) setHydration({ conv: conversationId, loading: false, error: null });
      })
      .catch((cause) => {
        if (alive) {
          setHydration({
            conv: conversationId,
            loading: false,
            error: cause instanceof Error ? cause.message : '生成文件记录读取失败',
          });
        }
      });
    return () => { alive = false; };
  }, [conversationId]);

  const loading = hydration.conv === conversationId && hydration.loading;
  const error = hydration.conv === conversationId ? hydration.error : null;
  const panelState = resolveGeneratedFilesPanelState({ loading, error, fileCount: changes.length });
  const workspaceAvailable = Boolean(project.workspacePath);
  const sources = changes.map((change) => resolveGeneratedFileSource({
    change,
    activities: run?.toolActivities ?? [],
    workspaceAvailable,
  }));

  const openFile = (path: string) => {
    onOpenFile({
      path,
      name: path.split('/').pop() || path,
      url: `${getApiPrefix()}/workspaces/${encodeURIComponent(project.id)}/file?path=${encodeURIComponent(path)}`,
      workspaceDir: project.workspacePath,
      workspaceKind: project.workspaceKind,
    });
  };

  const showInFolder = async (path: string) => {
    if (!project.workspacePath) {
      setActionNotice('当前项目没有本地工作区路径');
      return;
    }
    const filesBridge = getBridge('files');
    if (!filesBridge?.showInFolder) {
      setActionNotice('桌面文件定位能力不可用');
      return;
    }
    try {
      const result = await filesBridge.showInFolder(project.workspacePath, path);
      setActionNotice(result.ok ? '' : (result.error || '无法在文件管理器中显示该文件'));
    } catch (cause) {
      setActionNotice(cause instanceof Error ? cause.message : '无法在文件管理器中显示该文件');
    }
  };

  return (
    <div className={styles.panel} data-testid="generated-files-surface" data-state={panelState}>
      <div className={styles.panelHeader}>
        <Icon name="file" size={15} />
        <strong>生成文件</strong>
        <span className={styles.muted}>{changes.length > 0 ? `${changes.length} 个` : ''}</span>
      </div>

      {panelState === 'loading' && <p className={styles.empty}>正在读取本会话的生成文件记录…</p>}
      {panelState === 'error' && (
        <p className={styles.error} role="alert">{error || '生成文件记录读取失败。'}</p>
      )}
      {panelState === 'empty' && (
        <p className={styles.empty}>当前会话还没有写入过工作区文件。</p>
      )}

      {actionNotice ? <p className={styles.error} role="alert">{actionNotice}</p> : null}

      {panelState === 'ready' && (
        <div className={styles.list}>
          {sources.map((source) => (
            <article key={source.path} className={styles.row} data-evidence={source.evidenceState}>
              <div className={styles.rowHeader}>
                <Icon name="file" size={13} />
                <span className={styles.path} title={source.path}>{source.path}</span>
                <span className={styles.badge}>{source.status === 'created' ? '新建' : '修改'}</span>
              </div>
              <div className={styles.meta}>
                {source.tool ? <span>工具：{source.tool}</span> : null}
                {typeof source.iteration === 'number' ? <span>第 {source.iteration} 轮</span> : null}
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className="petri-btn petri-btn--ghost petri-btn--sm"
                  onClick={() => openFile(source.path)}
                  disabled={!source.workspaceAvailable}
                  title={source.workspaceAvailable ? '打开当前工作区版本' : '工作区文件不可用'}
                >
                  当前工作区版本
                </button>
                <button
                  type="button"
                  className="petri-btn petri-btn--ghost petri-btn--sm"
                  onClick={() => void showInFolder(source.path)}
                  disabled={!source.workspaceAvailable}
                >
                  文件管理器
                </button>
                <button
                  type="button"
                  className="petri-btn petri-btn--ghost petri-btn--sm"
                  onClick={() => setExpanded((value) => ({ ...value, [source.path]: !value[source.path] }))}
                >
                  工具记录
                </button>
                {onAskAgent ? (
                  <button
                    type="button"
                    className="petri-btn petri-btn--ghost petri-btn--sm"
                    onClick={() => onAskAgent(`请解释生成文件 ${source.path} 的改动、影响范围与可回退方式。`)}
                  >
                    加入对话
                  </button>
                ) : null}
              </div>
              {expanded[source.path] ? (
                <div className={styles.detail}>
                  {source.toolRecordAvailable ? (
                    <pre className={styles.code}>{source.toolRecordContent}</pre>
                  ) : (
                    <p className={styles.muted}>
                      {source.toolRecordReason === 'no_write_activity'
                        ? '没有找到对应的写入工具记录；当前只保留工作区版本。'
                        : '工具记录存在，但没有可预览的内容（例如通过命令或外部程序写入）。'}
                    </p>
                  )}
                  {source.toolRecordTruncated ? <p className={styles.muted}>工具记录已截断。</p> : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
