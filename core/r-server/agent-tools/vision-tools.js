/**
 * agent-tools/vision-tools.js — agent-led 阶段2 Task4：agent 看图工具
 *
 * tool_read_image：从 tool_jobs 的结果目录读 PNG → base64，供 agent 解读图内容。
 * 链路：toolJobId → 查 tool_jobs.result_json 拿 jobDir → path.join(jobDir, fileName)
 *      → fs.readFileSync → base64。
 *
 * agent 循环里 tool_result 含 imageBase64 时，ai-agent.js 改用 vision provider
 * （callVision）喂 image_url content block，让 qwen-vl-max 看图。
 */
const fs = require('fs');
const path = require('path');
const dbMod = require('../db');
const config = require('../config');
const { callVision } = require('../helpers/llm-client');
const { getApiKey } = require('../helpers/ai-settings');

/**
 * tool_read_image — 读工具结果的图，用 qwen-vl-max 解读图内容（agent-led 阶段2 Task4）。
 *
 * 设计：agent 调本工具后，后端读图 base64 → 直接调 DashScopeVisionProvider 解读 →
 * 把"图里看到的内容"作为 tool_result 文本返回给 agent。这样 agent 循环不用改
 * （deepseek-chat 仍跑文本循环，vision 解读在 read_image 内部完成）。
 *
 * @param {object} args - { toolJobId, fileName?, question? }
 *   - toolJobId: tool_jobs.id（run_tool 返回的）
 *   - fileName: 可选，指定读哪个图。不传则读第一张 plot。
 *   - question: 可选，问图什么（默认"描述这张图的主要内容"）。
 * @returns {Promise<{ok, description, fileName}|{error, message}>}
 */
async function tool_read_image(args, ctx) {
  const toolJobId = args && args.toolJobId;
  if (!toolJobId) return { error: 'missing_toolJobId', message: '需要 toolJobId' };

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
  let targetName = args.fileName;
  if (!targetName) {
    const plot = outputs.find((o) => o.type === 'plot' || /\.(png|jpg|jpeg|svg)$/i.test(o.name || ''));
    targetName = plot ? plot.name : files.find((f) => /\.(png|jpg|jpeg|svg)$/i.test(f));
  }
  // fallback：outputs/files 都没找到，直接列 jobDir 目录找第一张图
  if (!targetName && jobDir && fs.existsSync(jobDir)) {
    const listDir = (dir) => {
      try { return fs.readdirSync(dir); } catch { return []; }
    };
    const allFiles = [...listDir(path.join(jobDir, 'output')), ...listDir(jobDir)];
    const img = allFiles.find((f) => /\.(png|jpg|jpeg|svg)$/i.test(f));
    if (img) targetName = img;
  }
  if (!targetName) return { error: 'no_image', message: '结果目录里没找到图文件' };

  const candidates = [
    path.join(jobDir, 'output', targetName),
    path.join(jobDir, targetName),
  ];
  let imgPath = null;
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      imgPath = p;
      break;
    }
  }
  if (!imgPath) return { error: 'file_not_found', message: `${targetName} 在 ${jobDir} 下不存在` };

  const ext = path.extname(targetName).toLowerCase();
  const mimeType =
    ext === '.png' ? 'image/png' :
    ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
    ext === '.svg' ? 'image/svg+xml' : 'image/png';

  const buf = fs.readFileSync(imgPath);
  if (buf.length > 4 * 1024 * 1024) {
    return { error: 'image_too_large', message: `${targetName} ${(buf.length/1024/1024).toFixed(1)}MB 超 4MB 上限` };
  }
  const imageBase64 = buf.toString('base64');
  const dataUrl = `data:${mimeType};base64,${imageBase64}`;

  // 调 vision provider 解读图
  const apiKey = getApiKey('dashscope');
  if (!apiKey) {
    return { error: 'no_vision_key', message: 'DashScope API key 未配置，无法看图。请在设置页填 DashScope key。' };
  }

  const question = (args.question || '描述这张生物信息学图的主要内容：图表类型、轴标签、数据分布、显著特征。').slice(0, 500);
  const visionBody = {
    model: 'qwen-vl-max',
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
  const visionResp = await callVision(apiKey, visionBody, telemetry);

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
    _note: '图已用 qwen-vl-max 解读，上方 description 是图内容描述，可直接据此回答用户。',
  };
}

module.exports = {
  tool_read_image,
};
