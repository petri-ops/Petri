import { useEffect, useRef, useState } from 'react';

import { CodeMirrorEditor } from '@/components/editor/CodeMirror/CodeMirrorEditor';
import type { DiffRevision, EditorApi } from '@/components/editor/CodeMirror/types';
import { getBridge } from '@/lib/desktopBridge';

export interface CodeMirrorDiffViewProps {
  filePath: string;
  isBinary: boolean;
  /** BLOCK-25: receives the live EditorApi so the drawer can scroll to findings. */
  onEditorApi?: (api: EditorApi | null) => void;
}

interface FileContentResult {
  ok: boolean;
  data?: { content: string; truncated?: boolean };
  error?: string;
  message?: string;
}

export function CodeMirrorDiffView({ filePath, isBinary, onEditorApi }: CodeMirrorDiffViewProps) {
  const [revision, setRevision] = useState<DiffRevision | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<EditorApi | null>(null);

  useEffect(() => {
    onEditorApi?.(editorRef.current);
    return () => onEditorApi?.(null);
  }, [onEditorApi, revision !== null]);

  useEffect(() => {
    if (!filePath || isBinary) {
      setRevision(null);
      setError(null);
      return;
    }

    const bridge = getBridge('workingTreeReview');
    if (!bridge) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setRevision(null);

    const load = async (): Promise<void> => {
      const headResult = (await bridge.fileContent({
        path: filePath,
        ref: 'HEAD',
      })) as FileContentResult;

      const worktreeResult = (await bridge.fileContent({
        path: filePath,
        ref: 'WORKTREE',
      })) as FileContentResult;

      if (cancelled) return;

      if (!worktreeResult.ok) {
        setError(worktreeResult.message || worktreeResult.error || 'Failed to load working tree content.');
        return;
      }

      setRevision({
        filePath,
        originalText: headResult.ok ? (headResult.data?.content ?? '') : '',
        modifiedText: worktreeResult.data?.content ?? '',
      });
    };

    load().catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [filePath, isBinary]);

  if (isBinary) {
    return <div className="wt-file-binary">Binary file changed</div>;
  }

  if (loading) {
    return <div className="wt-diff-loading">Loading diff…</div>;
  }

  if (error) {
    return <div className="wt-diff-error" role="alert">{error}</div>;
  }

  if (!revision) return null;

  return (
    <CodeMirrorEditor
      ref={editorRef}
      value={revision.modifiedText}
      mode="inline-diff"
      diffRevision={revision}
      readonly={true}
      language={filePath}
      className="wt-cm-diff"
    />
  );
}
