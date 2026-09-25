/**
 * KnowledgeSearchProbe — BLOCK-103 P3 检索预览页签（自 KnowledgeSpacePanel 拆出）
 *
 * 原「检索测试」框：top-k 命中预览 + 文档过滤 + 通道标注（语义/全文）+ 命中高亮。
 * 检索状态自持；spaceId 与 ready 文档清单由 KnowledgeSpacePanel 下发。
 */

import React, { useCallback, useState } from 'react';
import {
  searchKnowledgeInSpace,
  type KnowledgeDoc,
  type KnowledgeHit,
} from '@/lib/knowledgeClient';
import { HighlightedText, splitQueryTokens } from './knowledge-utils';
import styles from './KnowledgeSpacePanel.module.css';

export function KnowledgeSearchProbe({
  spaceId,
  filterableDocs,
}: {
  spaceId: string;
  filterableDocs: KnowledgeDoc[];
}): React.ReactElement {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDocId, setSearchDocId] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchHits, setSearchHits] = useState<KnowledgeHit[] | null>(null);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [searchDegraded, setSearchDegraded] = useState(false);
  const [searchTokens, setSearchTokens] = useState<string[]>([]);

  const handleSearch = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query || searching) return;
    setSearching(true);
    setSearchNote(null);
    setSearchDegraded(false);
    setSearchTokens(splitQueryTokens(query));
    try {
      const result = await searchKnowledgeInSpace(query, spaceId, undefined, searchDocId || undefined);
      setSearchHits(result.hits);
      setSearchDegraded(!!result.ftsDegraded);
      if (result.readyChunks === 0) setSearchNote('当前空间没有已就绪的可检索内容（可能过滤条件过窄或尚未上传）。');
      else if (result.hits.length === 0 && !result.embeddingAvailable) setSearchNote('嵌入模型不可用，仅全文通道检索且本次无命中。');
      else if (result.hits.length === 0) setSearchNote('两条检索通道均无命中。');
    } catch (e) {
      setSearchHits(null);
      setSearchNote(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }, [searchQuery, searchDocId, searching, spaceId]);

  return (
    <div className={styles.searchBox}>
      <div className={styles.searchTitle}>检索预览</div>
      <p className={styles.searchIntro}>预览对话自动检索会命中的内容块与通道得分，用于确认知识库「能被找到」。</p>
      {filterableDocs.length > 0 && (
        <select
          className={styles.searchFilter}
          value={searchDocId}
          onChange={(e) => setSearchDocId(e.target.value)}
          data-testid="knowledge-search-doc-filter"
        >
          <option value="">全部文档</option>
          {filterableDocs.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      )}
      <div className={styles.searchRow}>
        <input
          className={styles.searchInput}
          placeholder="输入查询，预览 top-k 命中"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSearch();
          }}
          data-testid="knowledge-search-input"
        />
        <button
          type="button"
          className={styles.primaryBtn}
          disabled={searching || !searchQuery.trim()}
          onClick={() => void handleSearch()}
          data-testid="knowledge-search-btn"
        >
          {searching ? '检索中…' : '检索'}
        </button>
      </div>
      {searchNote && <div className={styles.searchNote}>{searchNote}</div>}
      {searchDegraded && (
        <div className={styles.searchNote} data-testid="knowledge-search-degraded">
          查询语法无法进入全文索引（纯符号或过短），已降级为子串匹配。
        </div>
      )}
      {searchHits && searchHits.length > 0 && (
        <div className={styles.hitList} data-testid="knowledge-search-hits">
          {searchHits.map((hit) => (
            <div key={hit.docId} className={styles.hitRow}>
              <div className={styles.hitHead}>
                <span className={styles.hitDoc}>{hit.docName} · 第 {hit.seq + 1} 块</span>
                <span className={styles.hitScore}>
                  {hit.channels.vector != null ? `语义 ${hit.channels.vector.toFixed(2)}` : ''}
                  {hit.channels.vector != null && hit.channels.fts != null ? ' + ' : ''}
                  {hit.channels.fts != null ? '全文' : ''}
                </span>
              </div>
              <div className={styles.hitText}>
                <HighlightedText text={hit.text.slice(0, 220) + (hit.text.length > 220 ? '…' : '')} tokens={searchTokens} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

