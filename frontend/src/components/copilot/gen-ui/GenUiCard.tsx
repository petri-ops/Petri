/**
 * frontend/src/components/copilot/gen-ui/GenUiCard.tsx
 *
 * BLOCK-166 [B 层] 聊天流内嵌 Gen UI 卡片（P0 基础版）：
 * prepare IPC（主进程做 workspace 归属/1MB 校验并返回沙箱页 URL）→ 独立 origin
 * iframe 渲染 → guest 高度回报（240..10000px + 5px gutter）。
 * 放大预览/复制图（P2）、widgetState（P1/P2）不在本版。
 */

import React from 'react';
import { getBridge } from '@/lib/desktopBridge';
import type { GenUiReference } from './schema';
import styles from './GenUiCard.module.css';

const HEIGHT_MIN = 240;
const HEIGHT_MAX = 10000;

interface GenUiPrepareOk {
  ok: true;
  url: string;
}
interface GenUiPrepareError {
  ok: false;
  code:
    | 'no-workspace'
    | 'project-not-found'
    | 'outside-scope'
    | 'file-not-found'
    | 'too-large'
    | 'read-failed'
    | 'failed';
  message: string;
}
export type GenUiPrepareResult = GenUiPrepareOk | GenUiPrepareError;

const ERROR_TEXT: Record<GenUiPrepareError['code'], string> = {
  'no-workspace': '当前会话未绑定项目工作区，无法渲染可视化页',
  'project-not-found': '未找到会话所属项目，无法定位可视化目录',
  'outside-scope': '可视化文件不在本会话的可视化目录内，已拒绝渲染',
  'file-not-found': '可视化文件不存在（模型可能尚未写入或路径不符）',
  'too-large': '可视化文件超过 1MB 上限，已拒绝渲染',
  'read-failed': '读取可视化文件失败',
  failed: '可视化页准备失败',
};

interface GenUiCardProps {
  reference: GenUiReference;
  projectId: string;
  conversationId: string | null;
  /** 卡片实例键（prepare 结果缓存键用）。 */
  cardKey: string;
}

export const GenUiCard = React.memo(function GenUiCard({
  reference,
  projectId,
  conversationId,
  cardKey,
}: GenUiCardProps) {
  const [result, setResult] = React.useState<GenUiPrepareResult | null>(null);
  const [height, setHeight] = React.useState<number>(HEIGHT_MIN);
  const frameRef = React.useRef<HTMLIFrameElement | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setResult(null);
    if (!conversationId) {
      setResult({ ok: false, code: 'no-workspace', message: 'conversationId missing' });
      return undefined;
    }
    const bridge = getBridge('genUi');
    if (!bridge) {
      setResult({ ok: false, code: 'failed', message: 'desktop bridge unavailable' });
      return undefined;
    }
    bridge
      .prepare({ projectId, conversationId, path: reference.path, title: reference.title })
      .then((res: { ok: true; url: string } | { ok: false; code: string; message: string }) => {
        if (cancelled) return;
        if (res.ok) {
          setResult({ ok: true, url: res.url });
          return;
        }
        // 桥侧类型是宽 code:string——边界处收窄到已知集合，未知码兜底 failed。
        const knownCodes: GenUiPrepareError['code'][] = [
          'no-workspace', 'project-not-found', 'outside-scope', 'file-not-found', 'too-large', 'read-failed', 'failed',
        ];
        const code = (knownCodes as string[]).includes(res.code)
          ? (res.code as GenUiPrepareError['code'])
          : 'failed';
        setResult({ ok: false, code, message: res.message });
      })
      .catch(() => {
        if (!cancelled) setResult({ ok: false, code: 'failed', message: 'IPC error' });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, conversationId, reference.path, reference.title, cardKey]);

  // guest 高度回报：只信 source 为本卡 iframe 的消息（规格 §6.3；P0 无桥）。
  React.useEffect(() => {
    if (!result?.ok) return undefined;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { type?: string; height?: unknown } | null;
      if (!data || data.type !== 'petri-gen-ui-height') return;
      const value = typeof data.height === 'number' && Number.isFinite(data.height) ? data.height : 0;
      setHeight(Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, Math.round(value))));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [result]);

  const title = reference.title || '可视化';

  return (
    <div
      className={`${styles.card}${reference.mode === 'wide' ? ` ${styles.cardWide}` : ''}`}
      data-testid="gen-ui-card"
    >
      <div className={styles.header}>
        <span className={styles.headerTitle}>{title}</span>
        {result?.ok ? <span className={styles.badge}>沙箱页面</span> : null}
      </div>
      <div className={styles.body}>
        {result === null ? (
          <div className={styles.placeholder}>正在加载可视化…</div>
        ) : result.ok ? (
          <div className={styles.frameWrap} style={{ height: height + 10 }}>
            <iframe
              ref={frameRef}
              className={styles.frame}
              src={result.url}
              title={title}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              loading="lazy"
            />
          </div>
        ) : (
          <div className={styles.errorBox} role="alert">
            <span>{ERROR_TEXT[result.code]}</span>
            <span className={styles.errorHint}>{reference.path}</span>
          </div>
        )}
      </div>
    </div>
  );
});
