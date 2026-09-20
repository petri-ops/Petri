/**
 * agent-tools/vision-tools.js — agent-led 阶段2 Task4：agent 看图工具
 *
 * tool_read_image：两条读图链路 → base64，供 agent 解读图内容。
 *   1. 结果图（toolJobId）：tool_jobs.result_json 拿 jobDir → path.join(jobDir, fileName)
 *   2. 工作区静态图（filePath，BLOCK-52 P2）：ctx.projectId → project.workspace_path
 *      → 相对路径包含校验（词法 + realpath 双重，防路径穿越/符号链接逃逸）
 * 链路：fs.readFileSync → base64 → vision provider 解读。
 *
 * agent 循环里 tool_result 含 imageBase64 时，ai-agent.js 改用 vision provider
 * （callVision）喂 image content block，让当前 vision 角色模型看图。
 */
const fs = require('fs');
const path = require('path');
const dbMod = require('../db');
require('../config');
const { callVision } = require('../helpers/llm-client');
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
 * tool_read_image — 读图（结果图 / 工作区静态图），用 vision 角色模型解读图内容。
 *
 * 设计：agent 调本工具后，后端读图 base64 → 直接调 DashScopeVisionProvider 解读 →
 * 把"图里看到的内容"作为 tool_result 文本返回给 agent。这样 agent 循环不用改
 * （文本 Agent 循环与 vision 解读分别按任务角色解析模型）。
 *
 * 两种输入（二选一）：
 *   - toolJobId: tool_jobs.id（run_tool 返回的）；可选 fileName 指定读哪张图，不传读第一张 plot。
 *   - filePath: workspace 相对路径（BLOCK-52 P2 图片引用；前端「引用到对话」消息正文里的 path）。
 *     需 ctx.projectId 项目上下文，边界校验见 resolveWorkspaceImagePath。
 * @param {object} args - { toolJobId?, fileName?, filePath?, question? }
 * @returns {Promise<{ok, description, fileName}|{error, message}>}
 */
async function tool_read_image(args, ctx) {
  const toolJobId = args && args.toolJobId;
  const filePath = args && args.filePath;
  if (!toolJobId && !filePath) {
    return { error: 'missing_toolJobId', message: '需要 toolJobId 或 filePath（二选一）' };
  }

  let imgPath = null;
  let targetName = null;
  let sshReadFn = null;
  if (filePath) {
    const resolved = resolveWorkspaceImagePath(ctx, filePath);
    if (resolved.error) return resolved;
    if (resolved.sshRead) {
      sshReadFn = resolved.sshRead;
      targetName = resolved.fileName;
    } else {
      imgPath = resolved.imgPath;
      targetName = resolved.fileName;
    }
  } else {
    const job = dbMod.getToolJob(toolJobId);
    if (!job) return { error: 'job_not_found', message: `tool_job ${toolJobId} 不存在` };
    if (job.status !== 'completed') {
      return { error: 'job_not_completed', message: `任务状态 ${job.status}，无法读图` };
    }

    const result = job.result || {};
    const jobDir = result.jobDir;
    if (!jobDir) return { error: 'no_jobDir', message: 'result 里没有 jobDir 路径' };

    const outputs = result.outputs || [];
    const files = result.files || [];
    targetName = args.fileName;
    if (!targetName) {
      const plot = outputs.find((o) => o.type === 'plot' || IMAGE_EXT_RE.test(o.name || ''));
      targetName = plot ? plot.name : files.find((f) => IMAGE_EXT_RE.test(f));
    }
    // fallback：outputs/files 都没找到，直接列 jobDir 目录找第一张图
    if (!targetName && jobDir && fs.existsSync(jobDir)) {
      const listDir = (dir) => {
        try { return fs.readdirSync(dir); } catch { return []; }
      };
      const allFiles = [...listDir(path.join(jobDir, 'output')), ...listDir(jobDir)];
      const img = allFiles.find((f) => IMAGE_EXT_RE.test(f));
      if (img) targetName = img;
    }
    if (!targetName) return { error: 'no_image', message: '结果目录里没找到图文件' };

    const candidates = [
      path.join(jobDir, 'output', targetName),
      path.join(jobDir, targetName),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        imgPath = p;
        break;
      }
    }
    if (!imgPath) return { error: 'file_not_found', message: `${targetName} 在 ${jobDir} 下不存在` };
  }

  let buf;
  if (sshReadFn) {
    const readResult = await sshReadFn();
    if (readResult && readResult.error) return readResult;
    buf = readResult;
    if (!(buf && buf.length > 0)) {
      return { error: 'file_unreadable', message: `${targetName} 远端读取为空` };
    }
  } else {
    buf = fs.readFileSync(imgPath);
  }
  const ext = path.extname(imgPath || targetName).toLowerCase();
  const mimeType = IMAGE_MIME[ext] || 'image/png';

  if (buf.length > MAX_IMAGE_BYTES) {
    return { error: 'image_too_large', message: `${targetName} ${(buf.length/1024/1024).toFixed(1)}MB 超 4MB 上限` };
  }
  const imageBase64 = buf.toString('base64');
  const dataUrl = `data:${mimeType};base64,${imageBase64}`;

  // 调 vision provider 解读图
  const question = (args.question || '描述这张生物信息学图的主要内容：图表类型、轴标签、数据分布、显著特征。').slice(0, 500);
  const visionBody = {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: question },
          { type: 'image', image: dataUrl },
        ],
      },
    ],
  };

  const telemetry = { userId: ctx && ctx.userId, conversationId: ctx && ctx.conversationId, kind: 'vision' };
  const visionResp = await callVision('', visionBody, telemetry);

  if (!visionResp || visionResp.error) {
    return {
      ok: false,
      error: 'vision_failed',
      message: `看图失败: ${visionResp ? visionResp.error + ' ' + (visionResp.message || '') : '无响应'}`,
      fileName: targetName,
    };
  }

  return {
    ok: true,
    fileName: targetName,
    description: visionResp.content || '（vision 模型未返回描述）',
    usage: visionResp.usage,
    _note: '图已用当前 vision 角色模型解读，上方 description 是图内容描述，可直接据此回答用户。',
  };
}

module.exports = {
  tool_read_image,
  resolveWorkspaceImagePath,
};
