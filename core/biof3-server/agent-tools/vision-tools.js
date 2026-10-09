/**
 * agent-tools/vision-tools.js — agent-led 阶段2 Task4：agent 看图工具
 *
 * tool_read_image：两条读图链路 → base64，供 agent 解读图内容。
 *   1. 结果图（toolJobId）：tool_jobs.result_json 拿 jobDir → path.join(jobDir, fileName)
 *   2. 工作区静态图（filePath，BLOCK-52 P2）：ctx.projectId → project.workspace_path
 *      → 相对路径包含校验（词法 + realpath 双重，防路径穿越/符号链接逃逸）
 * 链路：fs.readFileSync → base64 → vision provider 解读。
 *
 * BLOCK-155：工作区图片路径解析与「字节→data URL（4MB/白名单守卫）」已抽到
 * vision-image-io.js 共享（chat 内联链与 read_image 同源读图）；本文件 re-export
 * resolveWorkspaceImagePath 维持既有导入面不变，行为零变化。
 */
const fs = require('fs');
const path = require('path');
const dbMod = require('../db');
require('../config');
const { callVision } = require('../helpers/llm-client');
const {
  IMAGE_EXT_RE,
  imageDataUrlFromBuffer,
  resolveWorkspaceImagePath,
} = require('./vision-image-io');

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
  // BLOCK-155：字节→data URL（扩展→MIME + 4MB 上限）复用 vision-image-io 共享 helper
  const dataUrlResult = imageDataUrlFromBuffer(buf, imgPath || targetName, targetName);
  if (dataUrlResult.error) return dataUrlResult;
  const dataUrl = dataUrlResult.dataUrl;

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
