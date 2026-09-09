import { useEffect, useRef } from 'react';
import { gewuEvents, subscribeGewuEvent } from '@/lib/events';
import { __resetFileReferenceCache } from '@/lib/chat-file-references';

/**
 * BLOCK-68 / UI-317 —— 「刷新文件链接」composer 入口删除后的自动化等价物。
 *
 * 订阅 agent 写档 / 数据导入后的既有信号 `projectWorkspaceChanged`
 * （RightFileTree 已消费同源信号，不新建第二套文件变更真相），debounce 后
 * 清解析缓存并触发回调（SimpleChat 侧为 resolveNonce++），已落地消息的
 * 文件链接自动重解析——自动化后用户无感，无手动反馈层。
 */
export function useAutoFileReferenceRefresh(onRefresh: () => void, debounceMs = 500): void {
  const timerRef = useRef<number | null>(null);
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  });

  useEffect(() => {
    const unsubscribe = subscribeGewuEvent(gewuEvents.projectWorkspaceChanged, () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        __resetFileReferenceCache();
        onRefreshRef.current();
      }, debounceMs);
    });
    return () => {
      unsubscribe();
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [debounceMs]);
}
