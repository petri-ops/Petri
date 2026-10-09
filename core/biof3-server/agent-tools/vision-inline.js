/**
 * agent-tools/vision-inline.js — BLOCK-155：真·单通道 vision 内联变换（纯函数）
 *
 * 背景：用户消息正文里的图片附件行（前端 attachmentUpload.ts 产出，
 * 形如 `[附件: .chat-attachments/x.png（123KB）]`）此前只是文本引用，模型需经
 * read_image 工具二次读图（双通道）。本模块在 chat 请求体侧把**最后一条 user
 * 消息**里的图片附件行内联为 OpenAI 规范 image_url 部件——单通道直发。
 *
 * 设计约束：
 *   - 纯变换：messages 数组与消息对象绝不突变；恒等场景返回原数组引用
 *   - fail-soft：某张图读取失败跳过该图（文本行保留在 text 部件里）；全部
 *     失败 → 恒等回旧路径（模型仍可走 read_image 工具兜底）
 *   - 附件行正则与前端 attachmentInline.ts 同形态（path + 可选全角括号大小标签）
 *   - 内联图片扩展白名单 png/jpg/jpeg（刻意窄于 read_image 链的 png/jpg/jpeg/svg，
 *     见 INLINE_IMAGE_EXT_RE 注释——svg 内联会被上游 chat 端点 400）
 *
 * chatVisionInlineCapable：渠道是否吃 image_url 部件的判定。
 *   - openai-family 集合单源取自 model-gateway.js OPENAI_FAMILY_PROVIDERS
 *     （deepseek/openai/openai-compatible/ollama/lmstudio/vllm，chat 原样
 *     JSON.stringify 透传 OpenAI 规范）
 *   - anthropic 实证纳入：其 chat/chatStream 均经
 *     core/shared-backend/llm-providers/anthropic.js :150/:177 的
 *     openAIToAnthropicRequest → protocol-conversion.js openAIMessageToAnthropic
 *     (:68) → openAIContentToAnthropic (:27-36)，image_url 部件被转换为
 *     {type:'image', source:{type:'base64', media_type, data}}
 *   - dashscope / dashscope-vision 原生协议不在集合，不内联
 */
const { OPENAI_FAMILY_PROVIDERS } = require('../../shared-backend/llm-providers/model-gateway');

/** 附件行：`[附件: path]` 或 `[附件: path（50.7KB）]`（全角括号大小标签可选）。 */
const ATTACHMENT_LINE_RE = /^\[附件: (.+?)(?:（[^）]*）)?\]$/;
/**
 * 内联图片扩展白名单——比 vision-image-io 的 IMAGE_EXT_RE（png/jpg/jpeg/svg）**刻意收窄**：
 * svg 不内联（换眼评审 P2-1）。openai/anthropic chat 端点的 image_url media_type 均不收
 * svg base64，内联会把主链请求打成 400（整 run 终止）；svg 仍走 read_image 工具链
 * （其失败面是工具级，run 继续）。两侧差异由测试 ⑥ 与 agent-vision 既有断言分别钉住。
 */
const INLINE_IMAGE_EXT_RE = /\.(png|jpg|jpeg)$/i;

/**
 * 从消息正文里抽出图片类附件行的工作区相对路径（保持出现顺序）。
 * @param {string} text
 * @returns {string[]}
 */
function extractAttachmentImagePaths(text) {
  const paths = [];
  for (const line of text.split('\n')) {
    const m = ATTACHMENT_LINE_RE.exec(line.trim());
    if (m && INLINE_IMAGE_EXT_RE.test(m[1])) paths.push(m[1]);
  }
  return paths;
}

/**
 * 内联变换：定位 messages 中最后一条 role==='user' 的消息；其 content 为字符串
 * 且含图片类附件行时，返回新数组（该消息替换为 content 部件数组——首元素
 * type text 保留原字符串全文，其后每个**可读**图一个 type image_url 元素）。
 * 其余消息保持原引用不动。无图片行 / content 非字符串 / 无 user 消息 / 全部
 * 图读取失败 → 返回原数组（恒等）。
 *
 * @param {Array<{role:string, content:string|Array}>} messages
 * @param {{readImageDataUrl: (relativePath: string) => string|null|Promise<string|null>}} deps
 *   读图注入（data URL 或 null；抛错按 null 处理）
 * @returns {Promise<Array>} 新数组或原数组引用
 */
async function inlineVisionImagesForRequest(messages, deps = {}) {
  if (!Array.isArray(messages)) return messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.role !== 'user') continue;
    if (typeof message.content !== 'string') return messages; // content 非字符串 → 恒等
    const imagePaths = extractAttachmentImagePaths(message.content);
    if (imagePaths.length === 0) return messages; // 无图片行 → 恒等

    const parts = [{ type: 'text', text: message.content }];
    for (const relativePath of imagePaths) {
      let dataUrl = null;
      try {
        dataUrl = await deps.readImageDataUrl(relativePath);
      } catch {
        dataUrl = null; // fail-soft：读取抛错跳过该图
      }
      if (typeof dataUrl === 'string' && dataUrl) {
        parts.push({ type: 'image_url', image_url: { url: dataUrl } });
      }
    }
    if (parts.length === 1) return messages; // 全部读取失败 → 恒等回旧路径
    const next = messages.slice();
    next[i] = { ...message, content: parts };
    return next;
  }
  return messages; // 无 user 消息 → 恒等
}

/**
 * 渠道能力判定：profile 声明 vision 能力，且 provider 的 chat 发送链吃
 * OpenAI 规范 image_url 部件（openai-family 集合，单源 model-gateway；
 * anthropic 经 protocol-conversion 转换，实证纳入）。
 * @param {{provider?: string, capabilities?: string[]}|null} profile
 * @returns {boolean}
 */
function chatVisionInlineCapable(profile) {
  if (!profile || typeof profile !== 'object') return false;
  const capabilities = Array.isArray(profile.capabilities) ? profile.capabilities : [];
  if (!capabilities.includes('vision')) return false;
  const provider = String(profile.provider || '');
  return OPENAI_FAMILY_PROVIDERS.has(provider) || provider === 'anthropic';
}

module.exports = {
  inlineVisionImagesForRequest,
  chatVisionInlineCapable,
};
