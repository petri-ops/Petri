/**
 * KnowledgeSpacePanel — BLOCK-69 / UI-318 知识空间管理面（BLOCK-103 P1 重构）
 *
 * 数据所有者 + 信息架构：状态条（切换器内联 + 真 switch 启用开关 + 状态徽章）
 * → 通知动作卡组 → 双页签（文档库 / 检索预览）。
 * 文档与检索交互拆至 KnowledgeDocLibrary / KnowledgeSearchProbe（700 棘轮净减）。
 * 启用状态单一真相 = DB；无 DashScope key 时诚实空态（BLOCK-69 D7），不假启用。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { fetchKnowledgeSpace, setKnowledgeSpaceEnabled, type KnowledgeSpaceState } from '@/lib/knowledgeClient';
import { KnowledgeSpaceSwitcher } from './KnowledgeSpaceSwitcher';
import { KnowledgeDocLibrary } from './KnowledgeDocLibrary';
import { KnowledgeSearchProbe } from './KnowledgeSearchProbe';
import { subscribePetriEvent } from '@/lib/events';
import { BUSY_STATUSES } from './knowledge-utils';
import styles from './KnowledgeSpacePanel.module.css';

type PanelTab = 'docs' | 'search';

export function KnowledgeSpacePanel() {
  const navigate = useNavigate();
  const [state, setState] = useState<KnowledgeSpaceState | null>(null);
  // BLOCK-99 P2 — 当前空间（默认 ks_default；切换经 KnowledgeSpaceSwitcher）
  const [spaceId, setSpaceId] = useState('ks_default');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  // BLOCK-94 F1 分页：首屏 50 篇，「加载更多」按 50 递增（服务端钳制 200）
  const [docLimit, setDocLimit] = useState(50);
  // BLOCK-103 D1 — 页签：文档库（核心）/ 检索预览（工具）
  const [tab, setTab] = useState<PanelTab>('docs');

  const refresh = useCallback(async () => {
    try {
      const next = await fetchKnowledgeSpace({ docLimit, spaceId });
      setState(next);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [docLimit, spaceId]);

  // 轮询：摄取期 2s 快刷；空闲 10s 慢刷（外部/其他窗口上传的文档也能及时出现）
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // BLOCK-99 G4 — 管理台会话驱动变更后即时刷新（双通道同一真相；轮询兜底不变）
  useEffect(
    () =>
      subscribePetriEvent('petri:knowledge-console-sync', () => {
        void refresh();
      }),
    [refresh]
  );

  useEffect(() => {
    const hasBusy = (state?.documents || []).some((doc) => BUSY_STATUSES.has(doc.status));
    const timer = setInterval(() => void refresh(), hasBusy ? 2000 : 10000);
    return () => clearInterval(timer);
  }, [state?.documents, refresh]);

  const enabled = !!state?.space?.enabled;
  const embeddingAvailable = state ? state.embeddingAvailable : true;
  const documents = state?.documents || [];
  const documentsTotal = state?.documentsTotal ?? documents.length;
  const documentsHasMore = !!state?.documentsHasMore;
  const staleEmbedding = state?.staleEmbedding;
  const scale = state?.scale;
  const readyCount = documents.filter((d) => d.status === 'ready').length;
  const busyCount = (state?.queueDepth ?? 0) + documents.filter((d) => BUSY_STATUSES.has(d.status)).length;
  const failedCount = documents.filter((d) => d.status === 'failed').length;
  const filterableDocs = documents.filter((d) => d.status === 'ready');

  const handleToggle = useCallback(async () => {
    setToggleError(null);
    try {
      await setKnowledgeSpaceEnabled(!enabled, spaceId);
    } catch (e) {
      setToggleError(e instanceof Error ? e.message : String(e));
    }
    await refresh();
  }, [enabled, spaceId, refresh]);

  return (
    <div className={styles.panel} data-testid="knowledge-panel">
      {/* BLOCK-103 D5 — 通知动作卡组（同屏合并一张卡；缺 key 附去设置动作） */}
      {(loadError || toggleError || (state && (!embeddingAvailable || staleEmbedding?.staleChunks || scale?.scanWarning))) && (
        <div className={styles.noticeCard} data-testid="knowledge-notices">
          {loadError && <div className={`${styles.noticeRow} ${styles.noticeRowError}`}>加载失败：{loadError}</div>}
          {toggleError && <div className={`${styles.noticeRow} ${styles.noticeRowError}`}>{toggleError}</div>}
          {state && !embeddingAvailable && (
            <div className={styles.noticeRow} data-testid="knowledge-embed-unavailable">
              <span className={styles.noticeText}>
                绑定向量模型（设置 → 模型 → 向量模型）后可启用知识空间的语义检索。当前无法启用。
              </span>
              <button
                type="button"
                className={styles.noticeAction}
                onClick={() => void navigate('/settings')}
                data-testid="knowledge-open-settings"
              >
                <Icon name="settings" size={12} />
                去设置
              </button>
            </div>
          )}
          {state && enabled && !embeddingAvailable && (
            <div className={styles.noticeRow} data-testid="knowledge-degraded-fts">
              嵌入模型当前不可用，自动召回降级为仅全文通道（仍可用，语义检索暂不可达）。
            </div>
          )}
          {state && scale && scale.scanWarning && (
            <div className={styles.noticeRow} data-testid="knowledge-scale-warning">
              规模警戒：就绪分块 {scale.readyChunks} 已超过向量扫描观测阈值 {scale.scanWarnThreshold}（检索仍可用，性能评估见 BLOCK-94 plan §8）。
            </div>
          )}
          {state && staleEmbedding && staleEmbedding.staleChunks > 0 && (
            <div className={styles.noticeRow} data-testid="knowledge-stale-embedding">
              嵌入模型已变更：{staleEmbedding.staleDocs} 篇文档的 {staleEmbedding.staleChunks} 个旧向量已被隔离（不影响全文检索），
              建议对这些文档执行「重建索引」。
            </div>
          )}
        </div>
      )}

      {/* BLOCK-103 — 状态条：空间切换 + 启用 switch + 状态徽章（三重头部收敛于此） */}
      <div className={styles.statusStrip} data-testid="knowledge-status-strip">
        <KnowledgeSpaceSwitcher spaceId={spaceId} onSwitch={setSpaceId} onChanged={() => { void refresh(); }} />
        <div className={styles.stripRight}>
          {state && (
            <span className={styles.badgeRow}>
              <span className={`${styles.badge} ${styles.badgeReady}`}>就绪 {readyCount}</span>
              {busyCount > 0 && <span className={`${styles.badge} ${styles.badgeBusy}`}>摄取中 {busyCount}</span>}
              {failedCount > 0 && <span className={`${styles.badge} ${styles.badgeFailed}`}>失败 {failedCount}</span>}
              <span className={`${styles.badge} ${styles.badgeMuted}`}>共 {documentsTotal} 篇</span>
            </span>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            className={`${styles.switchBtn} ${enabled ? styles.switchBtnOn : ''}`}
            disabled={!embeddingAvailable || !state}
            onClick={() => { void handleToggle(); }}
            data-testid="knowledge-toggle"
            title={embeddingAvailable ? (enabled ? '对话自动检索已开启' : '开启后对话自动检索') : '需要先绑定向量模型（1024 维）'}
          >
            <span className={styles.switchKnob} />
            <span className={styles.switchLabel}>{enabled ? '已启用' : '未启用'}</span>
          </button>
        </div>
      </div>

      {/* BLOCK-103 D1 — 双页签：文档库（核心）/ 检索预览（工具） */}
      <div className={styles.tabsBar} role="tablist" data-testid="knowledge-tabs">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'docs'}
          className={`${styles.tabBtn} ${tab === 'docs' ? styles.tabBtnActive : ''}`}
          onClick={() => setTab('docs')}
          data-testid="knowledge-tab-docs"
        >
          <Icon name="list-details" size={13} />
          文档库
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'search'}
          className={`${styles.tabBtn} ${tab === 'search' ? styles.tabBtnActive : ''}`}
          onClick={() => setTab('search')}
          data-testid="knowledge-tab-search"
        >
          <Icon name="search" size={13} />
          检索预览
        </button>
      </div>

      {tab === 'docs' ? (
        <KnowledgeDocLibrary
          spaceId={spaceId}
          documents={documents}
          documentsTotal={documentsTotal}
          documentsHasMore={documentsHasMore}
          knowledgeDir={state?.knowledgeDir}
          onLoadMore={() => setDocLimit((l) => l + 50)}
          onChanged={() => void refresh()}
        />
      ) : (
        <KnowledgeSearchProbe spaceId={spaceId} filterableDocs={filterableDocs} />
      )}
    </div>
  );
}

