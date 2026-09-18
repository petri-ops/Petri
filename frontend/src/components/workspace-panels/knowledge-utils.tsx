import React from 'react';
import type { KnowledgeDocStatus } from '@/lib/knowledgeClient';
import styles from './KnowledgeSpacePanel.module.css';

// BLOCK-99 P2 — 自 KnowledgeSpacePanel.tsx 原样抽离的纯工具/小组件（台账线
// 治理：主文件只减不增）。无本地状态依赖；样式沿用面板 module（视觉零变更）。

export const STATUS_LABEL: Record<KnowledgeDocStatus, string> = {
  uploaded: '已上传',
  parsing: '解析中',
  chunking: '分块中',
  embedding: '嵌入中',
  ready: '就绪',
  failed: '失败',
};

export const BUSY_STATUSES = new Set(['uploaded', 'parsing', 'chunking', 'embedding']);

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

// BLOCK-94 F5：查询分词（≥2 字符片段）用于命中高亮
export function splitQueryTokens(query: string): string[] {
  return String(query || '')
    .trim()
    .split(/[\s,，。;；!？?·、\n]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

export function HighlightedText({ text, tokens }: { text: string; tokens: string[] }) {
  if (!tokens.length || !text) return <>{text}</>;
  const escaped = tokens
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length);
  let re: RegExp;
  try {
    re = new RegExp(`(${escaped.join('|')})`, 'gi');
  } catch {
    return <>{text}</>;
  }
  const parts = text.split(re);
  const isHit = new RegExp(`^(?:${escaped.join('|')})$`, 'i');
  return (
    <>
      {parts.map((part, i) => (part && isHit.test(part) ? <mark key={i} className={styles.hitMark}>{part}</mark> : <React.Fragment key={i}>{part}</React.Fragment>))}
    </>
  );
}
