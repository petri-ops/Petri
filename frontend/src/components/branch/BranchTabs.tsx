// ============================================================
// BranchTabs — Branch switcher component for TitleBar center area
//
// Phase 1: Branch Tab UI
// Displays as horizontal tabs in the TitleBar center, left of the result picker.
// Features:
//   - Horizontal branch tabs with active state highlight
//   - + button to create new branch
//   - Right-click context menu: rename, delete
//   - Branch switch triggers IPC call + store update
// ============================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import type { Branch } from '@/types/branch.types';
import styles from './BranchTabs.module.css';

interface BranchTabsProps {
  branches: Branch[];
  activeBranchId: string | null;
  onSwitch: (branchId: string) => Promise<void>;
  onCreate: (name: string, parentBranchId?: string) => Promise<Branch | null>;
  onRename: (branchId: string, newName: string) => Promise<boolean>;
  onDelete: (branchId: string) => Promise<boolean>;
  loading?: boolean;
}

interface ContextMenuState {
  branchId: string;
  x: number;
  y: number;
}

export function BranchTabs({
  branches,
  activeBranchId,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
  loading = false,
}: BranchTabsProps): React.ReactElement {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [creating, setCreating] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');

  const contextMenuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const newBranchInputRef = useRef<HTMLInputElement>(null);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [contextMenu]);

  // Close context menu on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
        setRenaming(null);
        setCreating(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

  // Focus new branch input when creating
  useEffect(() => {
    if (creating && newBranchInputRef.current) {
      newBranchInputRef.current.focus();
    }
  }, [creating]);

  const handleContextMenu = useCallback((e: React.MouseEvent, branchId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ branchId, x: e.clientX, y: e.clientY });
  }, []);

  const handleRename = useCallback(
    async (branchId: string) => {
      const trimmed = renameValue.trim();
      if (!trimmed) {
        setRenaming(null);
        return;
      }
      setRenaming(null);
      await onRename(branchId, trimmed);
    },
    [renameValue, onRename]
  );

  const handleCreate = useCallback(async () => {
    const trimmed = newBranchName.trim();
    if (!trimmed) {
      setCreating(false);
      setNewBranchName('');
      return;
    }
    setCreating(false);
    setNewBranchName('');
    await onCreate(trimmed, activeBranchId || undefined);
  }, [newBranchName, activeBranchId, onCreate]);

  const handleDelete = useCallback(
    async (branchId: string) => {
      setContextMenu(null);
      await onDelete(branchId);
    },
    [onDelete]
  );

  const startRename = useCallback((branch: Branch) => {
    setContextMenu(null);
    setRenaming(branch.id);
    setRenameValue(branch.name);
  }, []);

  if (branches.length === 0 && !loading) {
    return (
      <div className={styles.branchTabs}>
        <button
          type="button"
          className={styles.addButton}
          onClick={() => setCreating(true)}
          title="创建分支"
          aria-label="创建分支"
        >
          <Icon name="plus" size={14} />
        </button>
        {creating && (
          <div className={styles.newBranchInput}>
            <input
              ref={newBranchInputRef}
              type="text"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate();
                if (e.key === 'Escape') {
                  setCreating(false);
                  setNewBranchName('');
                }
              }}
              onBlur={() => void handleCreate()}
              placeholder="分支名称"
              className={styles.input}
              maxLength={64}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.branchTabs}>
      {branches.map((branch) => (
        <div
          key={branch.id}
          className={`${styles.branchTab} ${branch.id === activeBranchId ? styles.branchTabActive : ''}`}
          onContextMenu={(e) => handleContextMenu(e, branch.id)}
        >
          {renaming === branch.id ? (
            <input
              ref={renameInputRef}
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleRename(branch.id);
                if (e.key === 'Escape') setRenaming(null);
              }}
              onBlur={() => void handleRename(branch.id)}
              className={styles.renameInput}
              maxLength={64}
            />
          ) : (
            <button
              type="button"
              className={styles.branchTabButton}
              onClick={() => void onSwitch(branch.id)}
              title={branch.name}
              aria-pressed={branch.id === activeBranchId}
            >
              <Icon name="git-branch" size={12} />
              <span className={styles.branchTabText}>{branch.name}</span>
            </button>
          )}
        </div>
      ))}

      <button
        type="button"
        className={styles.addButton}
        onClick={() => setCreating(true)}
        title="创建新分支"
        aria-label="创建新分支"
      >
        <Icon name="plus" size={14} />
      </button>

      {creating && (
        <div className={styles.newBranchInput}>
          <input
            ref={newBranchInputRef}
            type="text"
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate();
              if (e.key === 'Escape') {
                setCreating(false);
                setNewBranchName('');
              }
            }}
            onBlur={() => void handleCreate()}
            placeholder="分支名称"
            className={styles.input}
            maxLength={64}
          />
        </div>
      )}

      {contextMenu && (
        <>
          <button
            type="button"
            className={styles.contextMenuOverlay}
            onClick={() => setContextMenu(null)}
            aria-label="关闭菜单"
          />
          <div
            ref={contextMenuRef}
            className={styles.contextMenu}
            style={{ left: contextMenu.x, top: contextMenu.y }}
            role="menu"
          >
            <button
              type="button"
              className={styles.contextMenuItem}
              onClick={() => {
                const branch = branches.find((b) => b.id === contextMenu.branchId);
                if (branch) startRename(branch);
              }}
              role="menuitem"
            >
              <Icon name="more-horizontal" size={13} />
              <span>重命名</span>
            </button>
            <button
              type="button"
              className={`${styles.contextMenuItem} ${styles.contextMenuItemDanger}`}
              onClick={() => void handleDelete(contextMenu.branchId)}
              role="menuitem"
            >
              <Icon name="trash" size={13} />
              <span>删除</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
