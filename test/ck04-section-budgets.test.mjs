/**
 * CK-04（C-04）— system-prompt 分段 token 预算治理契约。
 *
 * 覆盖：
 *   - 零破坏：buildSystemPrompt 与 buildSystemPromptSections().prompt 同 context 输出全等
 *   - pageContent 段超限截断 + 诚实标注（原字符数）
 *   - 计量报告 sections（base/body chars 与 prompt 长度对账）
 *   - 无超限时输出与旧语义一致（section 无截断标注）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resolve = (...segments) => path.resolve(__dirname, '..', ...segments);
const require = createRequire(import.meta.url);
const sp = require(resolve('core/petri-server/helpers/system-prompt.js'));

const CTX = {
  page: 'desktop-project',
  projectId: 'p_ck04',
  pageTitle: '预算治理测试',
  projectDatasets: [{ id: 'ds1', name: '数据集A', rows: 100, type: 'matrix' }],
  projectJobs: [{ id: 'job1', status: 'done', name: '差异分析' }],
  pageContent: '',
};

test('CK-04 零破坏：两种导出对同一 context 输出全等', () => {
  const a = sp.buildSystemPrompt(CTX, { provider: 'test', model: 'm1' });
  const b = sp.buildSystemPromptSections(CTX, { provider: 'test', model: 'm1' }).prompt;
  assert.equal(a, b);
});

test('CK-04 sections 计量与 prompt 长度对账', () => {
  const { prompt, sections } = sp.buildSystemPromptSections(CTX, {});
  const base = sections.find((s) => s.name === 'base');
  const body = sections.find((s) => s.name === 'body');
  assert.ok(base && base.chars > 0, 'base 段有计量');
  assert.ok(body && body.chars > 0, 'body 段有计量');
  assert.equal(base.chars + body.chars, prompt.length, 'base+body=总长');
});

test('CK-04 pageContent 超限截断 + 诚实标注', () => {
  const big = '长'.repeat(12000);
  const { prompt } = sp.buildSystemPromptSections({ ...CTX, pageContent: big }, {});
  assert.ok(prompt.length < big.length + 2000, '超限被截断');
  assert.ok(prompt.includes('已截断，原 12011 字符'), '诚实标注原字符数（含标题行 11 字符）');
  // 未超限时不标注
  const small = '短'.repeat(100);
  const { prompt: p2 } = sp.buildSystemPromptSections({ ...CTX, pageContent: small }, {});
  assert.ok(!p2.includes('已截断'), '未超限无标注');
});

test('CK-04 pageContent 未设时无该段且无标注', () => {
  const { prompt, sections } = sp.buildSystemPromptSections(CTX, {});
  assert.ok(!prompt.includes('【当前界面正文】') || CTX.pageContent !== '');
  assert.ok(!prompt.includes('已截断'));
  assert.ok(Array.isArray(sections));
});

test('CK-04 workingTreeRejects 段受函数内既有上限治理（字符预算为冗余防线）', () => {
  const rejects = Array.from({ length: 50 }, (_, i) => ({
    filePath: '/w/f' + i + '.py',
    reason: '用户拒绝'.repeat(200),
  }));
  const { prompt } = sp.buildSystemPromptSections({ ...CTX, workingTreeRejects: rejects }, {});
  // 渲染函数内部上限（10 条 × 行 80）先治理；段级 4000 兜底不触发则无标注——
  // 本断言锁「输出受控」（远小于 50 条全量），治理归属在函数内既有机制。
  assert.ok(prompt.length < 20000, 'rejects 段输出受控');
});
