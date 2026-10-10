/**
 * agent-tools/vision-image-io.js — BLOCK-155：工作区图片读取共享 helper
 *
 * 从 vision-tools.js 抽出的「工作区图片路径解析 + 读字节转 data URL（含
 * 4MB/扩展白名单守卫）」可复用模块（行为零变化重构）：
 *   - resolveWorkspaceImagePath：本地 + SSH 双变体、词法/realpath 双重路径
 *     逃逸守卫（BLOCK-52 P2 / BLOCK-91 原语义逐字保留）
 *   - imageDataUrlFromBuffer：扩展→MIME + 4MB 上限 + base64 data URL
 *   - readWorkspaceImageDataUrl：上面两者的 fail-soft 组合（返回 data URL
 *     字符串或 null），BLOCK-155 chat 内联链与 read_image 工具同源读图入口
 */
const fs = require('fs');
const path = require('path');
const dbMod = require('../db');
const workspaceGateway = require('../helpers/workspace-gateway');

const IMAGE_EXT_RE = /\.(png|jpg|jpeg|svg)$/i;
const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml' };
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * 解析工作区静态图片的绝对路径（BLOCK-52 P2）。
 * 边界校验与 workspace-tools.resolveWorkspaceTarget 同级：
 * 词法包含 + realpath 包含（最近存在祖先），防路径穿越与符号链接逃逸。
 */
function resolveWorkspaceImagePath(ctx, relativePath) {
  const projectId = String((ctx && ctx.projectId) || '').trim();
  if (!projectId) {
    return { error: 'project_required', message: '读工作区图片需要项目上下文（projectId）' };
  }
  const project = dbMod.getProject(projectId);
  if (!project) return { error: 'project_not_found', message: `项目 ${projectId} 不存在` };

  // BLOCK-91：ssh 项目走 gateway（root=remote_path，backend.stat/read 远端读图）。
  // 此前仅支持本地 workspace_path——ssh 项目的附件图「定不住工作区路径」即此缺口。
  if (project.workspace_kind === 'ssh') {
    const { backend, root, error } = workspaceGateway.resolveWorkspaceBackend(project) || {};
    if (error || !backend || !root) {
      return { error: 'workspace_unavailable', message: '远程工作区不可用' };
    }
    const trimmed = String(relativePath || '').trim();
    if (!trimmed) return { error: 'missing_filePath', message: '需要 filePath（workspace 相对路径）' };
    const target = workspaceGateway.safeRemoteJoin(root, trimmed);
    if (!target) return { error: 'path_escape', message: '路径逃逸出当前项目工作区' };
    if (!IMAGE_EXT_RE.test(target)) {
      return { error: 'not_an_image', message: 'filePath 必须指向 png/jpg/jpeg/svg 图片' };
    }
    return {
      fileName: path.posix.basename(target),
      sshRead: async () => {
        try {
          const stat = await backend.stat(target);
          if (stat && stat.size > MAX_IMAGE_BYTES) {
            return { error: 'image_too_large', message: `${trimmed} ${(stat.size/1024/1024).toFixed(1)}MB 超 4MB 上限` };
          }
          return await backend.read(target);
        } catch (e) {
          if (e && e.remoteError === 'not_found') {
            return { error: 'file_not_found', message: `${trimmed} 在远程工作区中不存在` };
          }
          if (e && e.classified) {
            return { error: 'file_unreadable', message: `远程连接失败: ${e.classified.kind}` };
          }
          return { error: 'file_unreadable', message: `无法读取 ${trimmed}: ${e.message}` };
        }
      },
    };
  }

  if (!project.workspace_path || !path.isAbsolute(project.workspace_path)) {
    return { error: 'workspace_unavailable', message: '项目工作区路径未配置或不是绝对路径' };
  }
  const trimmed = String(relativePath || '').trim();
  if (!trimmed) return { error: 'missing_filePath', message: '需要 filePath（workspace 相对路径）' };

  let realRoot;
  try {
    realRoot = fs.realpathSync(project.workspace_path);
  } catch (error) {
    return { error: 'workspace_unavailable', message: `项目工作区不可访问: ${error.message}` };
  }

  const target = path.resolve(realRoot, trimmed);
  if (target !== realRoot && !target.startsWith(realRoot + path.sep)) {
    return { error: 'path_escape', message: '路径逃逸出当前项目工作区' };
  }
  if (!IMAGE_EXT_RE.test(target)) {
    return { error: 'not_an_image', message: 'filePath 必须指向 png/jpg/jpeg/svg 图片' };
  }
  // realpath 包含检查：最近存在祖先，防符号链接指向工作区外
  let realTarget = target;
  try {
    fs.statSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { error: 'file_not_found', message: `${trimmed} 在工作区中不存在` };
    }
    return { error: 'file_unreadable', message: `无法访问 ${trimmed}: ${error.message}` };
  }
  try {
    realTarget = fs.realpathSync(target);
  } catch (error) {
    return { error: 'file_unreadable', message: `无法解析 ${trimmed}: ${error.message}` };
  }
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
    return { error: 'symlink_escape', message: '符号链接指向项目工作区外部' };
  }
  return { imgPath: realTarget, fileName: path.basename(realTarget) };
}

/**
 * 字节 → data URL（扩展→MIME + 4MB 上限守卫）。
 * @param {Buffer} buf - 图片字节
 * @param {string} extSource - 扩展名取自（本地绝对路径或显示名）
 * @param {string} label - 超限错误信息里的展示名
 * @returns {{dataUrl: string}|{error: 'image_too_large', message: string}}
 */
function imageDataUrlFromBuffer(buf, extSource, label) {
  const ext = path.extname(extSource || label || '').toLowerCase();
  const mimeType = IMAGE_MIME[ext] || 'image/png';

  if (buf.length > MAX_IMAGE_BYTES) {
    return { error: 'image_too_large', message: `${label || extSource} ${(buf.length/1024/1024).toFixed(1)}MB 超 4MB 上限` };
  }
  const imageBase64 = buf.toString('base64');
  return { dataUrl: `data:${mimeType};base64,${imageBase64}` };
}

/**
 * 读工作区图片为 data URL（fail-soft）。BLOCK-155 chat 内联链的读图入口：
 * 与 read_image 工具同一条 resolveWorkspaceImagePath 解析链（本地 readFileSync /
 * SSH gateway.backend.read），任何解析/读取/超限失败一律返回 null 由调用方跳过。
 * @returns {Promise<string|null>} data URL 或 null
 */
async function readWorkspaceImageDataUrl(ctx, relativePath) {
  try {
    const resolved = resolveWorkspaceImagePath(ctx, relativePath);
    if (!resolved || resolved.error) return null;
    let buf;
    if (resolved.sshRead) {
      const readResult = await resolved.sshRead();
      if (!readResult || readResult.error || !(readResult.length > 0)) return null;
      buf = readResult;
    } else {
      buf = fs.readFileSync(resolved.imgPath);
    }
    const out = imageDataUrlFromBuffer(buf, resolved.imgPath || resolved.fileName, resolved.fileName);
    return out.dataUrl || null;
  } catch (e) {
    // fail-soft 返 null 由调用方跳过；留一行诊断（与 chat.js 侧失败可见度纪律一致）
    console.warn('[block155] readWorkspaceImageDataUrl failed:', relativePath, e && e.message);
    return null;
  }
}

module.exports = {
  IMAGE_EXT_RE,
  resolveWorkspaceImagePath,
  imageDataUrlFromBuffer,
  readWorkspaceImageDataUrl,
};
