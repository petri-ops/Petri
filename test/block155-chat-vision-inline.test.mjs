// ============================================================
// test/block155-chat-vision-inline.test.mjs — BLOCK-155 真·单通道 vision
//
// 用户消息里的图片附件行（[附件: .chat-attachments/x.png（123KB）]，前端
// attachmentUpload.ts 产出）在 chat 主链请求体侧内联为 image_url 部件：
//   ① 无图片行 / content 非字符串 / 无 user 消息 → 恒等（原数组引用）
//   ② 最后一条 user 消息带图片行 → content 数组（text 保留原文 + image_url）
//   ③ 非图片附件行 → 恒等
//   ④ 某图读取失败 → fail-soft 跳过（文本行保留，不炸）；全部失败 → 恒等
//   ⑤ 更早的 user 消息带图不内联（只内联最后一条 user）
//   ⑥ 扩展过滤（png/jpg/jpeg/svg 在列，txt 不在）
//   ⑦ chatVisionInlineCapable 真值表（openai-family + vision；anthropic 实证纳入）
//   ⑧ loop-orchestrator 非侵入：visionInline 开启跑完一轮后 messages 本体仍是
//      字符串 content，reqBody 侧才出现 parts（runLoop 直测，harness 同
//      context-breaker.test.mjs）
//
// 运行：node --test test/block155-chat-vision-inline.test.mjs
// ============================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

// ---- DB 自举（⑧ runLoop 直测需要；loop-orchestrator 顶层 require ./db）----
// 与 context-breaker.test.mjs 同一基建：先跑生产 migration 链再加载被测模块。
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-block155-vision-inline-'));
process.env.PETRI_DB_PATH = path.join(tempDir, 'block155-vision-inline.db');
const { runMigrations } = require('../src/migration-runner');
await runMigrations(process.env.PETRI_DB_PATH, path.join(TEST_DIR, '../src/migrations'));

// ---- 被测模块（HK-01：实现前 require 失败 → 每条用例独立报红）----
let visionInlineMod = null;
let visionInlineLoadError = null;
try {
  visionInlineMod = require('../core/petri-server/agent-tools/vision-inline.js');
} catch (e) {
  visionInlineLoadError = e;
}

const inlineVisionImagesForRequest = visionInlineMod && visionInlineMod.inlineVisionImagesForRequest;
const chatVisionInlineCapable = visionInlineMod && visionInlineMod.chatVisionInlineCapable;

// ---------- ① 恒等路径 ----------
test('BLOCK-155 ① 恒等：无图片行 / content 非字符串 / 无 user 消息 → 原数组引用', async () => {
  assert.ok(!visionInlineLoadError, `vision-inline 模块应可加载: ${visionInlineLoadError}`);
  const readAll = () => 'data:image/png;base64,AA==';

  const noImageLine = [{ role: 'user', content: '普通消息，没有附件行' }];
  assert.strictEqual(await inlineVisionImagesForRequest(noImageLine, { readImageDataUrl: readAll }), noImageLine, '无图片行恒等');

  const arrayContent = [{ role: 'user', content: [{ type: 'text', text: '已是部件形态' }] }];
  assert.strictEqual(await inlineVisionImagesForRequest(arrayContent, { readImageDataUrl: readAll }), arrayContent, 'content 非字符串恒等');

  const noUser = [{ role: 'system', content: 'sys' }, { role: 'assistant', content: '答' }];
  assert.strictEqual(await inlineVisionImagesForRequest(noUser, { readImageDataUrl: readAll }), noUser, '无 user 消息恒等');

  const empty = [];
  assert.strictEqual(await inlineVisionImagesForRequest(empty, { readImageDataUrl: readAll }), empty, '空数组恒等');

  // 非图片附件行（txt/csv）→ 恒等（③ 同源断言）
  const txtOnly = [{ role: 'user', content: '数据在附件\n[附件: .chat-attachments/counts.csv（12KB）]' }];
  assert.strictEqual(await inlineVisionImagesForRequest(txtOnly, { readImageDataUrl: readAll }), txtOnly, '非图片附件行恒等');
});

// ---------- ② 最后一条 user 带图片行 → parts 数组 ----------
test('BLOCK-155 ② 最后一条 user 消息带图片行 → text 保留原文 + image_url 部件，其余消息原引用不动', async () => {
  assert.ok(!visionInlineLoadError, `vision-inline 模块应可加载: ${visionInlineLoadError}`);
  const original = '看下这张图\n\n[附件: .chat-attachments/umap.png（123KB）]';
  const messages = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: '第一轮问题' },
    { role: 'assistant', content: '第一轮回答' },
    { role: 'user', content: original },
  ];
  const out = await inlineVisionImagesForRequest(messages, {
    readImageDataUrl: (p) => (p === '.chat-attachments/umap.png' ? 'data:image/png;base64,QUJD' : null),
  });

  assert.notStrictEqual(out, messages, '应返回新数组');
  assert.strictEqual(out.length, messages.length, '长度不变（只替换目标消息）');
  assert.strictEqual(out[0], messages[0], 'system 消息原引用不动');
  assert.strictEqual(out[1], messages[1], '历史 user 消息原引用不动');
  assert.strictEqual(out[2], messages[2], 'assistant 消息原引用不动');

  const content = out[3].content;
  assert.ok(Array.isArray(content), '目标消息 content 应为数组');
  assert.strictEqual(out[3].role, 'user', 'role 保留');
  assert.deepStrictEqual(content[0], { type: 'text', text: original }, '首部件 type=text 且保留原字符串全文（附件行不剥离）');
  assert.deepStrictEqual(content[1], { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } }, 'image_url.url 等于 data URL');
  assert.strictEqual(content.length, 2, '一图一部件');

  // 非侵入：原数组与原消息对象不被突变
  assert.strictEqual(typeof messages[3].content, 'string', 'messages 本体仍是字符串 content');
  assert.strictEqual(messages[3].content, original, '原消息原文不变');
});

// ---------- ④ fail-soft ----------
test('BLOCK-155 ④ 某图读取失败 → fail-soft 跳过不炸（文本行保留）；全部失败/抛错 → 恒等回旧路径', async () => {
  assert.ok(!visionInlineLoadError, `vision-inline 模块应可加载: ${visionInlineLoadError}`);
  const original = '两张图\n[附件: .chat-attachments/good.png（1KB）]\n[附件: .chat-attachments/missing.png（1KB）]';
  const messages = [{ role: 'user', content: original }];

  const out = await inlineVisionImagesForRequest(messages, {
    readImageDataUrl: (p) => (p === '.chat-attachments/good.png' ? 'data:image/png;base64,R09PRA==' : null),
  });
  const content = out[0].content;
  assert.ok(Array.isArray(content), '仍应内联成功的那张');
  assert.deepStrictEqual(content[0], { type: 'text', text: original }, '失败图的附件行在文本部件里保留');
  assert.strictEqual(content.filter((p) => p.type === 'image_url').length, 1, '只内联读取成功的一张');
  assert.strictEqual(content.find((p) => p.type === 'image_url').image_url.url, 'data:image/png;base64,R09PRA==');
  assert.strictEqual(typeof messages[0].content, 'string', '原数组不突变');

  const allFail = [{ role: 'user', content: '[附件: .chat-attachments/x.png（1KB）]' }];
  assert.strictEqual(await inlineVisionImagesForRequest(allFail, { readImageDataUrl: () => null }), allFail, '全部读失败恒等');

  const throwReader = [{ role: 'user', content: '[附件: .chat-attachments/y.png（1KB）]' }];
  assert.strictEqual(
    await inlineVisionImagesForRequest(throwReader, { readImageDataUrl: () => { throw new Error('boom'); } }),
    throwReader,
    '读取抛错 fail-soft 恒等，不向上炸',
  );
});

// ---------- ⑤ 只内联最后一条 user ----------
test('BLOCK-155 ⑤ 更早的 user 消息带图不内联（只处理最后一条 user 消息）', async () => {
  assert.ok(!visionInlineLoadError, `vision-inline 模块应可加载: ${visionInlineLoadError}`);
  const messages = [
    { role: 'user', content: '[附件: .chat-attachments/old.png（9KB）]' },
    { role: 'assistant', content: '旧回答' },
    { role: 'user', content: '最后一轮没有附件' },
  ];
  const out = await inlineVisionImagesForRequest(messages, { readImageDataUrl: () => 'data:image/png;base64,T0xE' });
  assert.strictEqual(out, messages, '最后一条 user 无图片行 → 恒等（早前 user 的图不补内联）');
});

// ---------- ⑥ 扩展过滤 ----------
test('BLOCK-155 ⑥ 扩展过滤：png/jpg/jpeg 在列；svg/txt 不在（svg 属 chat 端点拒收面）', async () => {
  assert.ok(!visionInlineLoadError, `vision-inline 模块应可加载: ${visionInlineLoadError}`);
  const readAll = () => 'data:image/png;base64,RVhU';

  // svg 不内联（换眼评审 P2-1）：openai/anthropic chat 端点 media_type 均不收 svg base64，
  // 内联会把主链请求打成 400（run 终止）；旧路径 svg 失败面是 read_image 工具级。
  const svg = [{ role: 'user', content: 'logo\n[附件: pics/logo.svg（2KB）]' }];
  const svgOut = await inlineVisionImagesForRequest(svg, { readImageDataUrl: readAll });
  assert.strictEqual(svgOut, svg, 'svg 不内联→恒等（read_image 工具链保留 svg，失败面工具级）');

  const jpg = [{ role: 'user', content: '[附件: .chat-attachments/photo.jpg]' }];
  const jpgOut = await inlineVisionImagesForRequest(jpg, { readImageDataUrl: readAll });
  assert.ok(Array.isArray(jpgOut[0].content), 'jpg（无大小标签的附件行）应被内联');

  const jpeg = [{ role: 'user', content: '[附件: .chat-attachments/photo.jpeg（8KB）]' }];
  const jpegOut = await inlineVisionImagesForRequest(jpeg, { readImageDataUrl: readAll });
  assert.ok(Array.isArray(jpegOut[0].content), 'jpeg 应被内联');

  const txt = [{ role: 'user', content: '[附件: .chat-attachments/notes.txt（2KB）]' }];
  const txtOut = await inlineVisionImagesForRequest(txt, { readImageDataUrl: readAll });
  assert.strictEqual(txtOut, txt, 'txt 不在白名单 → 恒等');
});

// ---------- ⑦ chatVisionInlineCapable 真值表 ----------
test('BLOCK-155 ⑦ chatVisionInlineCapable 真值表（openai-family+vision=true；dashscope 系=false；无 vision=false；anthropic=true）', () => {
  assert.ok(!visionInlineLoadError, `vision-inline 模块应可加载: ${visionInlineLoadError}`);

  // openai-family 集合（model-gateway.js OPENAI_FAMILY_PROVIDERS 单源）
  assert.equal(chatVisionInlineCapable({ provider: 'openai-compatible', capabilities: ['chat', 'streaming', 'tools', 'vision'] }), true, 'openai-compatible+vision');
  assert.equal(chatVisionInlineCapable({ provider: 'deepseek', capabilities: ['chat', 'streaming', 'tools', 'vision'] }), true, 'deepseek+vision');
  assert.equal(chatVisionInlineCapable({ provider: 'openai', capabilities: ['chat', 'vision'] }), true, 'openai+vision');
  assert.equal(chatVisionInlineCapable({ provider: 'ollama', capabilities: ['chat', 'tools', 'vision'] }), true, 'ollama+vision');

  // dashscope 系原生协议不在集合
  assert.equal(chatVisionInlineCapable({ provider: 'dashscope', capabilities: ['vision'] }), false, 'dashscope（原生协议）');
  assert.equal(chatVisionInlineCapable({ provider: 'dashscope-vision', capabilities: ['vision'] }), false, 'dashscope-vision（原生协议）');

  // 无 vision 能力
  assert.equal(chatVisionInlineCapable({ provider: 'openai-compatible', capabilities: ['chat', 'streaming', 'tools'] }), false, '无 vision 能力');
  assert.equal(chatVisionInlineCapable({ provider: 'deepseek', capabilities: ['chat'] }), false, 'deepseek 无 vision');

  // anthropic：chat/chatStream 均经 openAIToAnthropicRequest → openAIContentToAnthropic
  // 转换 image_url 部件（anthropic.js :150/:177；protocol-conversion.js :27-36），实证纳入。
  assert.equal(chatVisionInlineCapable({ provider: 'anthropic', capabilities: ['chat', 'streaming', 'tools', 'vision'] }), true, 'anthropic+vision（协议链实证）');
  assert.equal(chatVisionInlineCapable({ provider: 'anthropic', capabilities: ['chat', 'tools'] }), false, 'anthropic 无 vision');

  // 边界
  assert.equal(chatVisionInlineCapable(null), false, 'null profile');
  assert.equal(chatVisionInlineCapable({}), false, '空 profile');
  assert.equal(chatVisionInlineCapable({ provider: 'openai-compatible' }), false, '缺 capabilities');
});

// ---------- ⑧ loop-orchestrator 非侵入（runLoop 直测）----------
const { runLoop } = require('../core/petri-server/loop-orchestrator');
const db = require('../core/petri-server/db.js');

// 1x1 最小合法 PNG（与 agent-vision.test.mjs 同源字节）
const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082',
  'hex',
);

function setupWorkspaceWithAttachment() {
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-block155-ws-'));
  fs.mkdirSync(path.join(wsDir, '.chat-attachments'), { recursive: true });
  fs.writeFileSync(path.join(wsDir, '.chat-attachments', 'umap.png'), PNG_BYTES);
  const project = db.createProject({ name: 'BLOCK-155-vision-inline', workspacePath: wsDir });
  return { project, wsDir };
}

function baseLoopArgs({ callChatProvider, events }) {
  return {
    toolCtx: { accessMode: 'read' },
    shouldAbort: () => false,
    emitToolResult: () => {},
    emitAssistant: (e) => events.push(e),
    emitDone: () => {},
    callChatProvider,
    conversationState: {},
  };
}

test('BLOCK-155 ⑧ visionInline 开启：reqBody 侧内联出 image_url，messages 本体跑完一轮仍是字符串 content', async () => {
  const { project } = setupWorkspaceWithAttachment();
  const events = [];
  const reqBodies = [];
  const userText = '看下这张图\n\n[附件: .chat-attachments/umap.png（123KB）]';
  const messages = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: '第一轮' },
    { role: 'assistant', content: '答' },
    { role: 'user', content: userText },
  ];

  const callChatProvider = async (_provider, _apiKey, reqBody) => {
    reqBodies.push(reqBody);
    return { choices: [{ message: { role: 'assistant', content: '完成' }, finish_reason: 'stop' }] };
  };

  const result = await runLoop({
    messages,
    ...baseLoopArgs({ callChatProvider, events }),
    config: {
      userId: 'user-block155',
      modelName: 'test-model',
      kind: 'primary',
      contextWindow: 64000,
      executionPolicy: { allowExecution: false },
      context: { projectId: project.id },
      visionInline: true,
    },
  });

  assert.equal(result.assistantText, '完成', '正常收尾');

  // 非侵入：跑完一轮后 messages 本体（含循环追加的 assistant 消息）content 恒为字符串
  assert.ok(messages.length >= 4, '循环会追加 assistant 消息');
  for (const m of messages) {
    assert.equal(typeof m.content, 'string', `messages 本体每条都应是字符串 content: ${JSON.stringify(m).slice(0, 120)}`);
  }
  assert.strictEqual(messages[3].content, userText, '最后一条 user 原文不变');

  // 请求体侧：最后一条 user 变 parts（text 原文 + image_url data URL）
  assert.ok(reqBodies.length >= 1, '至少一次模型调用');
  const sent = reqBodies[0].messages;
  assert.strictEqual(sent[0], messages[0], 'system 消息原引用进请求体');
  const sentLastUser = sent[sent.length - 1];
  assert.equal(sentLastUser.role, 'user');
  assert.ok(Array.isArray(sentLastUser.content), 'reqBody 里最后一条 user 的 content 应为数组部件');
  assert.deepStrictEqual(sentLastUser.content[0], { type: 'text', text: userText }, 'text 部件保留原文');
  const imgParts = sentLastUser.content.filter((p) => p.type === 'image_url');
  assert.equal(imgParts.length, 1, '一张图一个 image_url 部件');
  assert.ok(imgParts[0].image_url.url.startsWith('data:image/png;base64,'), `data URL 形态: ${imgParts[0].image_url.url.slice(0, 40)}`);
});

test('BLOCK-155 ⑧ 反例：visionInline 未开启 → reqBody 原样字符串 content（恒等回旧路径）', async () => {
  const { project } = setupWorkspaceWithAttachment();
  const events = [];
  const reqBodies = [];
  const userText = '看下这张图\n\n[附件: .chat-attachments/umap.png（123KB）]';
  const messages = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: userText },
  ];

  const callChatProvider = async (_provider, _apiKey, reqBody) => {
    reqBodies.push(reqBody);
    return { choices: [{ message: { role: 'assistant', content: '完成' }, finish_reason: 'stop' }] };
  };

  await runLoop({
    messages,
    ...baseLoopArgs({ callChatProvider, events }),
    config: {
      userId: 'user-block155',
      modelName: 'test-model',
      kind: 'primary',
      contextWindow: 64000,
      executionPolicy: { allowExecution: false },
      context: { projectId: project.id },
      // visionInline 不传 → 默认关闭
    },
  });

  const sentLastUser = reqBodies[0].messages[reqBodies[0].messages.length - 1];
  assert.equal(sentLastUser.role, 'user');
  assert.equal(sentLastUser.content, userText, '关闭时请求体仍是字符串 content（恒等）');
});

// ---------- ⑨ read_image 工具门：当前轮已内联图片确定性短路 ----------
const { tool_read_image } = require('../core/petri-server/agent-tools/vision-tools.js');
const { lastUserAttachmentImagePaths } = require('../core/petri-server/agent-tools/vision-inline.js');

test('BLOCK-155 ⑨ 工具门：filePath 命中内联集合→短路重定向（不触解析链/不花视觉调用）；未命中→照常走解析', async () => {
  const inlined = new Set(['.chat-attachments/umap.png']);
  // 命中：ctx 无 projectId——若无门，resolveWorkspaceImagePath 会返回 project_required 错误；
  // 有门则短路返回重定向（证明既没走解析链也不会发起第二次视觉请求）。
  const hit = await tool_read_image(
    { filePath: '.chat-attachments/umap.png', question: '图里有什么' },
    { block155InlinedImagePaths: inlined },
  );
  assert.equal(hit.ok, true, '命中内联集合应短路成功');
  assert.ok(String(hit.description).includes('内联'), '重定向话术应说明图片已内联');
  assert.ok(hit._note && hit._note.includes('未产生额外视觉请求'), '应标注未产生额外视觉请求');

  // './' 前缀归一化后同样命中（模型可能带 ./ 传路径）
  const dotted = await tool_read_image(
    { filePath: './.chat-attachments/umap.png', question: 'q' },
    { block155InlinedImagePaths: inlined },
  );
  assert.equal(dotted.ok, true, './ 前缀归一化后同样短路');

  // 未命中：照常走解析链（无 projectId → project_required，证明门有选择性、旧路径保留）
  const miss = await tool_read_image(
    { filePath: '.chat-attachments/other.png', question: 'q' },
    { block155InlinedImagePaths: inlined },
  );
  assert.equal(miss.error, 'project_required', '未命中集合应照常走解析链（历史图/结果图路径不受影响）');

  // 集合缺席（非 visionInline run）：行为与旧版一致
  const noGate = await tool_read_image({ filePath: '.chat-attachments/umap.png', question: 'q' }, {});
  assert.equal(noGate.error, 'project_required', '无内联集合时行为与旧版一致');
});

// ---------- ⑩ lastUserAttachmentImagePaths：只取最后一条 user 的图片行 ----------
test('BLOCK-155 ⑩ lastUserAttachmentImagePaths：最后一条 user 的图片附件路径（顺序保留），无则空', () => {
  const messages = [
    { role: 'user', content: '[附件: .chat-attachments/old.png（9KB）]' },
    { role: 'assistant', content: '答' },
    { role: 'user', content: '两张\n[附件: .chat-attachments/a.png（1KB）]\n[附件: .chat-attachments/notes.txt（2KB）]\n[附件: pics/b.jpg]' },
  ];
  assert.deepStrictEqual(
    lastUserAttachmentImagePaths(messages),
    ['.chat-attachments/a.png', 'pics/b.jpg'],
    '只取最后一条 user 的图片行（txt 过滤、顺序保留、早前 user 不取）',
  );
  assert.deepStrictEqual(lastUserAttachmentImagePaths([{ role: 'user', content: '无附件' }]), [], '无图片行→空');
  assert.deepStrictEqual(lastUserAttachmentImagePaths([]), [], '空消息→空');
});
