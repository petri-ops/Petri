import React, { useCallback, useEffect, useState } from 'react';
import {
  fetchKnowledgeSpaces,
  createKnowledgeSpace,
  renameKnowledgeSpace,
  deleteKnowledgeSpace,
  fetchKnowledgeSpaceImpact,
  type KnowledgeSpaceSummary,
} from '@/lib/knowledgeClient';
import styles from './KnowledgeSpaceSwitcher.module.css';

/**
 * BLOCK-99 P2/G2 — 知识空间切换器（空间列表/新建/重命名/删除）。
 *
 * 单一数据源 = /api/knowledge/spaces；切换经 onSwitch 上抛（面板按空间重新
 * 加载）。破坏性操作两步确认 + 影响面诚实列出（删除前拉 impact）。
 * ks_default 为默认空间：可改名不可删除（服务端 400 兜底）。
 */
export function KnowledgeSpaceSwitcher({
  spaceId,
  onSwitch,
  onChanged,
}: {
  spaceId: string;
  onSwitch: (id: string) => void;
  onChanged?: () => void;
}): React.ReactElement {
  const [spaces, setSpaces] = useState<KnowledgeSpaceSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [impact, setImpact] = useState<{ documents: number; chunks: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setSpaces(await fetchKnowledgeSpaces());
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      setLoadError(null);
      try {
        await fn();
        await reload();
        onChanged?.();
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [reload, onChanged]
  );

  const handleCreate = () => {
    const name = newName.trim();
    if (!name || busy) return;
    void run(async () => {
      const created = await createKnowledgeSpace(name);
      setCreating(false);
      setNewName('');
      onSwitch(created.id);
    });
  };

  const handleRename = (space: KnowledgeSpaceSummary) => {
    const name = window.prompt('重命名知识空间', space.name);
    if (name == null || name.trim() === '' || name.trim() === space.name) return;
    void run(() => renameKnowledgeSpace(space.id, name.trim()));
  };

  const handleDeleteClick = async (space: KnowledgeSpaceSummary) => {
    if (confirmDeleteId !== space.id) {
      setConfirmDeleteId(space.id);
      setImpact(await fetchKnowledgeSpaceImpact(space.id).catch(() => null));
      return;
    }
    setConfirmDeleteId(null);
    void run(async () => {
      const result = await deleteKnowledgeSpace(space.id);
      if (spaceId === space.id) onSwitch('ks_default');
      void result;
    });
  };

  const current = spaces.find((s) => s.id === spaceId);

  return (
    <div className={styles.switcher} data-testid="knowledge-space-switcher">
      <select
        className={styles.select}
        value={spaceId}
        onChange={(e) => onSwitch(e.target.value)}
        aria-label="知识空间选择"
        data-testid="knowledge-space-select"
      >
        {spaces.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}（{s.documents} 篇{s.enabled ? ' · 已启用' : ''}）
          </option>
        ))}
      </select>
      <button
        type="button"
        className={styles.btn}
        onClick={() => {
          setCreating((v) => !v);
          setConfirmDeleteId(null);
        }}
        aria-label="新建知识空间"
      >
        ＋新建
      </button>
      {current && (
        <>
          <button
            type="button"
            className={styles.btn}
            onClick={() => handleRename(current)}
            aria-label="重命名知识空间"
          >
            重命名
          </button>
          {spaceId !== 'ks_default' && (
            <button
              type="button"
              className={`${styles.btn} ${confirmDeleteId === spaceId ? styles.btnDanger : ''}`}
              onClick={() => void handleDeleteClick(current)}
              aria-label="删除知识空间"
              data-testid="knowledge-space-delete"
            >
              {confirmDeleteId === current.id
                ? `确认删除（${impact ? `${impact.documents} 篇文档` : '拉取影响面…'}）`
                : '删除'}
            </button>
          )}
        </>
      )}
      {creating && (
        <span className={styles.createRow}>
          <input
            className={styles.input}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="空间名称（1-60 字符）"
            maxLength={60}
            aria-label="新空间名称"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
            autoFocus
          />
          <button type="button" className={styles.btn} onClick={handleCreate} disabled={busy}>
            创建
          </button>
        </span>
      )}
      {loadError && <span className={styles.error}>{loadError}</span>}
    </div>
  );
}
