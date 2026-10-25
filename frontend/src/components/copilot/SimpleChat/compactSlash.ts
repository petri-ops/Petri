import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

/**
 * BLOCK-256 Q7 顺带外移：`/compact` 的网络/文案分支从 SimpleChat switch 抽出，
 * 行为逐字保持（原 BLOCK-172 CP-7 语义不变），用于给 SimpleChat code-size 让位。
 */
export async function runCompactSlash(conversationId: string): Promise<string> {
  try {
    const response = await fetch(getPlatformApiPrefix() + '/ai/conversations/' + encodeURIComponent(conversationId) + '/compact', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}),
      },
    });
    const data = (await response.json().catch(() => ({}))) as {
      status?: string;
      compacted?: boolean;
      reason?: string;
      compaction?: { coversCount?: number };
      error?: string;
    };
    if (response.ok && data.status === 'ok' && data.compacted) {
      return `上下文已压缩（覆盖 ${data.compaction?.coversCount ?? 0} 条较早消息）`;
    }
    if (data.reason === 'below_threshold' || data.reason === 'too_few_messages') {
      return '上下文尚未达到压缩阈值，无需压缩';
    }
    if (data.error === 'session compaction disabled') {
      return '会话压缩开关未开启（设置→实验特性）';
    }
    return '压缩失败：' + (data.error || 'HTTP ' + response.status);
  } catch (e) {
    return '压缩失败：' + (e instanceof Error ? e.message : '网络错误');
  }
}
