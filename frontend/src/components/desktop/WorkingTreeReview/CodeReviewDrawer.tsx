// ============================================================
// CodeReviewDrawer — BLOCK-20 PHASE 3 inline-edit slide-out drawer
//
// Slide-out panel for editing a single file in the working tree.
// Left pane = HEAD content (base), right pane = working tree (edited).
// Saves via desktopBridge.workspace.writeTextFile().
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import { getBridge } from '@/lib/desktopBridge';
import styles from './CodeReviewDrawer.module.css';

export interface CodeReviewDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Absolute path of the file to edit */
  filePath: string | null;
  /** Workspace root path (e.g. from project-workspace.tsx) */
  workspacePath: string | null;
}

interface FileContents {
  base: string;
  workTree: string;
}

export function CodeReviewDrawer({ isOpen, onClose, filePath, workspacePath }: CodeReviewDrawerProps) {
  const [contents, setContents] = useState<FileContents | null>(null);
  const [editedContent, setEditedContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBinary, setIsBinary] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load both HEAD and working tree content when drawer opens or file changes
  useEffect(() => {
    if (!isOpen || !filePath) {
      setContents(null);
      setEditedContent('');
      setError(null);
      setIsBinary(false);
      return;
    }

    const bridge = getBridge('workingTreeReview');
    if (!bridge) return;

    setLoading(true);
    setError(null);
    setIsBinary(false);

    const loadBoth = async () => {
      try {
        const [baseRes, wtRes] = await Promise.all([
          bridge.fileHeadContent({ path: filePath }),
          bridge.fileContent({ path: filePath, ref: 'WORKTREE' }),
        ]);

        if (!baseRes.ok || !wtRes.ok) {
          setError(baseRes.message || baseRes.error || wtRes.message || wtRes.error || 'Failed to load file');
          return;
        }

        const baseContent = baseRes.data?.content ?? '';
        const wtContent = wtRes.data?.content ?? '';

        // Check for binary content (base64 encoding indicates binary)
        const isBin = wtRes.data?.encoding === 'base64';
        setIsBinary(isBin);
        setContents({ base: baseContent, workTree: wtContent });
        setEditedContent(wtContent);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    };

    void loadBoth();
  }, [isOpen, filePath]);

  // Auto-focus textarea after content loads
  useEffect(() => {
    if (!loading && editedContent && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [loading, editedContent]);

  // Escape to close (no unsaved changes guard)
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const handleSave = useCallback(async () => {
    if (!filePath || !workspacePath) return;
    const bridge = getBridge('workspace');
    if (!bridge) {
      setError('Desktop bridge unavailable');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Derive relative path from workspace
      const relativePath = filePath.startsWith(workspacePath + '/')
        ? filePath.slice(workspacePath.length + 1)
        : filePath;
      const res = await bridge.writeTextFile(workspacePath, relativePath, editedContent);
      if (!res.ok) {
        setError(res.error || 'Failed to save');
        return;
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [filePath, workspacePath, editedContent, onClose]);

  if (!isOpen) return null;

  const hasChanges = contents && editedContent !== contents.workTree;

  return (
    <div className={styles.drawerBackdrop} onClick={onClose} role="dialog" aria-modal="true" aria-label="File editor">
      <div
        className={styles.drawerPanel}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={styles.drawerHeader}>
          <div className={styles.drawerTitle}>
            <span className={styles.drawerTitleLabel}>Edit File</span>
            {filePath && (
              <span className={styles.drawerFilePath} title={filePath}>
                {filePath}
              </span>
            )}
          </div>
          <div className={styles.drawerHeaderActions}>
            {hasChanges && (
              <span className={styles.unsavedMarker} title="Unsaved changes">●</span>
            )}
            <button
              type="button"
              className={styles.drawerBtn}
              onClick={onClose}
              disabled={saving}
              title="Close (Escape)"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className={styles.drawerError} role="alert">{error}</div>
        )}

        {/* Body */}
        <div className={styles.drawerBody}>
          {loading && (
            <div className={styles.drawerLoading}>Loading file content...</div>
          )}

          {!loading && isBinary && (
            <div className={styles.drawerBinary}>
              <span className={styles.binaryMarker}>Binary file — cannot edit inline</span>
            </div>
          )}

          {!loading && !isBinary && contents && (
            <div className={styles.diffContainer}>
              {/* Base (HEAD) pane */}
              <div className={styles.diffPane}>
                <div className={styles.diffPaneHeader}>
                  <span className={styles.diffPaneLabel}>HEAD (base)</span>
                </div>
                <textarea
                  className={styles.diffPaneTextarea}
                  value={contents.base}
                  readOnly
                  tabIndex={-1}
                  aria-label="Base content (read-only)"
                  spellCheck={false}
                />
              </div>

              {/* Working tree pane (editable) */}
              <div className={styles.diffPane}>
                <div className={styles.diffPaneHeader}>
                  <span className={styles.diffPaneLabel}>Working Tree (editable)</span>
                  {hasChanges && (
                    <span className={styles.editedMarker}>edited</span>
                  )}
                </div>
                <textarea
                  ref={textareaRef}
                  className={styles.editorTextarea}
                  value={editedContent}
                  onChange={(e) => setEditedContent(e.target.value)}
                  aria-label="Working tree content (editable)"
                  spellCheck={false}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.drawerFooter}>
          <span className={styles.drawerHint}>
            {hasChanges ? 'Save to write changes back, or press Escape to discard.' : 'No changes detected.'}
          </span>
          <div className={styles.drawerFooterActions}>
            <button
              type="button"
              className={styles.drawerBtn}
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`${styles.drawerBtn} ${styles.drawerBtnPrimary}`}
              onClick={() => void handleSave()}
              disabled={saving || !hasChanges || !filePath || !workspacePath}
              title={!workspacePath ? 'Workspace path not available' : undefined}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
