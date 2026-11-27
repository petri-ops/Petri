/**
 * item 83 打磨批：产物卡的常规操作单一调用面。
 * 只做查看/带出/复制——不提供任何编辑（裁剪/标注/滤镜）能力。
 */
import { getBridge } from './desktopBridge';

export interface GeneratedArtifactActionResult {
  ok: boolean;
  code?: string;
  message?: string;
}

/** 复制图片：只传 kind/filename，主进程按 fail-closed 校验后写剪贴板。 */
export async function copyGeneratedImage(
  kind: string,
  filename: string,
): Promise<GeneratedArtifactActionResult> {
  const app = getBridge('app');
  if (!app || typeof app.copyImage !== 'function') {
    return { ok: false, code: 'bridge_unavailable' };
  }
  return app.copyImage({ kind, filename });
}

/** 另存为：复用主进程保存对话框 + 本机来源流式写盘。 */
export async function downloadGeneratedArtifact(
  url: string,
  name: string,
): Promise<GeneratedArtifactActionResult> {
  const files = getBridge('files');
  if (!files || typeof files.downloadFromUrl !== 'function') {
    return { ok: false, code: 'bridge_unavailable' };
  }
  const result = await files.downloadFromUrl(url, name);
  return result.canceled ? { ok: false, code: 'canceled' } : { ok: result.ok, code: result.error };
}

/** 系统查看器打开：复用 file:open-path 的扩展名白名单。 */
export async function openGeneratedArtifact(
  filePath: string,
): Promise<GeneratedArtifactActionResult> {
  const files = getBridge('files');
  if (!files || typeof files.openPath !== 'function') {
    return { ok: false, code: 'bridge_unavailable' };
  }
  const result = await files.openPath(filePath);
  return { ok: result.ok, code: result.error };
}

/** 打开所在文件夹：传目录路径，openPath 对目录无扩展名校验。 */
export async function showGeneratedArtifactFolder(
  filePath: string,
): Promise<GeneratedArtifactActionResult> {
  const folder = filePath.replace(/[\\/][^\\/]*$/, '');
  return openGeneratedArtifact(folder);
}
