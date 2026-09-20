// ============================================================
// UntrackedFilePreview - UI-305 P2 extracted from ReviewMode.tsx (lines 357-395),
// behavior unchanged; main file imports it back as needed.
// ============================================================
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getBridge } from '@/lib/desktopBridge';
import { CodeMirrorEditor } from '@/components/editor';
import { FULLTEXT_LANGUAGE_BY_EXT } from './reviewModeHelpers';

export function UntrackedFilePreview({ path }: { path: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // BLOCK-32 — 项目级审阅隔离
  const { projectId } = useParams<{ projectId?: string }>();
  useEffect(() => {
    const bridge = getBridge('workingTreeReview');
    if (!bridge) return;
    let cancelled = false;
    setContent(null);
    setFailed(false);
    bridge.fileContent({ path, ref: 'WORKTREE', projectId })
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.data) {
          // BLOCK-50 — 文件已从工作区/仓库消失（历史残留条目）：占位而非报错
          if (res.data.missing || res.data.deleted) setContent('');
          else setContent(res.data.content);
        } else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
  }, [path]);
  if (failed) return <div className="wt-empty">未跟踪文件 — 内容读取失败。</div>;
  if (content === null) return <div className="wt-empty">未跟踪文件 — 内容加载中…</div>;
  if (content === '') return <div className="wt-empty">未跟踪文件 — 空文件或已不存在。</div>;
  return (
    <div className="rvw-fulltext-wrap" data-testid="rvw-untracked-preview">
      <CodeMirrorEditor
        value={content}
        language={FULLTEXT_LANGUAGE_BY_EXT[path.slice(path.lastIndexOf('.') + 1).toLowerCase()]}
        className="rvw-fulltext-editor"
      />
    </div>
  );
}
