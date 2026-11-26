/**
 * conversationActions — 会话级通用动作单源（试用反馈⑫ owner msg_9b268abb3522）。
 *
 * ①copyText：Electron 渲染进程里 navigator.clipboard 可能受限（静默失败），
 *   失败回退 execCommand('copy')；两者都失败返回 false，由调用方给可见反馈。
 * ②exportConversation：从 SimpleChat 抽出的原生另存为导出（from UI-444），
 *   右键菜单与消息面共用同一实现；notify 回调承载行内回执（不在此模块弹 UI）。
 * 零新依赖、暗色无关（不碰样式）。
 */
import { getBridge } from '@/lib/desktopBridge';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* Electron 渲染进程受限 → 走 fallback */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export async function exportConversation(
  conversationId: string,
  notify: (message: string) => void,
): Promise<void> {
  if (!conversationId) return;
  const url = `${getPlatformApiPrefix()}/ai/conversations/${encodeURIComponent(conversationId)}/export.md`;
  const token = getToken();
  let content: string | null = null;
  try {
    const resp = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
    if (resp.ok) content = await resp.text();
  } catch { content = null; }
  if (content == null) {
    notify('会话导出失败：无法读取会话内容');
    return;
  }
  const name = `会话导出-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.md`;
  const bridge = getBridge('files');
  if (bridge?.saveTextFile) {
    const r = await bridge.saveTextFile(name, content);
    if (r && r.ok && r.path) notify(`已导出：${r.path}`);
    else if (r && r.ok && r.canceled) { /* 用户取消，不打扰 */ }
    else notify('会话导出失败：' + ((r && r.error) || '未知原因'));
    return;
  }
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
