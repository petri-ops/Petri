/**
 * BLOCK-198 — D2「系统提示 cache 友好分层（静态前缀 + 动态尾）」的机械锚。
 *
 * 缘起：该点位自 BLOCK-195 起记为无锚。实码核实分层**早已实现**（`buildStaticTemplate` +
 * `STATIC_CACHE` + `invalidateStaticCache`），但既有测试只断"分段字符预算对账"（CK-04 的
 * 面），**cache 友好这个性质本身无人断言**——即"有实现无断言"。本测断三件可证的硬事实：
 *  ① 静态前缀跨不同 context **逐字节恒定**（这才是 provider 侧 prompt cache 能打中的前提）；
 *  ② 动态段确实**追加在前缀之后**（前缀不被动态内容插到中间，否则 ① 无意义）；
 *  ③ 模板构建有缓存且命中/失效**真实发生**（换 context 不重建静态模板；显式失效后才重建）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildSystemPrompt, buildSystemPromptSections, getCacheMetrics, resetCacheMetrics, invalidateStaticCache,
} = require('../core/petri-server/helpers/system-prompt.js');

const IDENTITY = { provider: 'deepseek', providerLabel: 'DeepSeek', model: 'deepseek-chat' };

test('静态前缀跨 context 逐字节恒定，动态段只追加在其后', () => {
  invalidateStaticCache();
  const base = buildSystemPrompt(null, IDENTITY);
  assert.ok(base.length > 100, '空 context 应仍产出静态前缀本体');
  const contexts = [
    { page: 'desktop-home' },
    { page: 'desktop-project', projectId: 'project-a', pageTitle: '单细胞分析' },
    {
      page: 'desktop-project',
      projectId: 'project-b',
      projectDatasets: [{ id: 'ds_1', name: 'counts.h5ad', rows: 1200, type: 'h5ad' }],
      projectJobs: [{ id: 'job_1', status: 'succeeded', name: 'QC', toolId: 'scanpy_qc' }],
    },
  ];
  for (const context of contexts) {
    const prompt = buildSystemPrompt(context, IDENTITY);
    assert.equal(prompt.startsWith(base), true, `context=${context.page}/${context.projectId || '-'} 的 prompt 不以同一静态前缀开头（分层被破坏=cache 必然打不中）`);
    assert.ok(prompt.length > base.length, '动态段应在前缀之后追加内容');
  }
});

test('同一静态前缀也覆盖运行身份段（身份在前的段序不得随 context 漂移）', () => {
  invalidateStaticCache();
  const base = buildSystemPrompt(null, IDENTITY);
  assert.match(base, /供应商：DeepSeek/);
  assert.match(base, /模型：deepseek-chat/);
  const withCtx = buildSystemPrompt({ page: 'desktop-project', projectId: 'project-a' }, IDENTITY);
  assert.equal(withCtx.startsWith(base), true, '身份披露段必须留在恒定前缀里，不能被动态段挤到后面');
});

test('静态模板只构建一次：换 context 命中缓存，显式失效后才重建', () => {
  invalidateStaticCache();
  resetCacheMetrics();
  buildSystemPrompt({ page: 'desktop-home' }, IDENTITY);
  const afterFirst = getCacheMetrics();
  assert.equal(afterFirst.staticBuilds, 1, '首次构建应恰好建一次静态模板');
  assert.equal(afterFirst.staticCacheHits, 0, '首建之后不应已有命中');

  buildSystemPrompt({ page: 'desktop-project', projectId: 'project-a' }, IDENTITY);
  buildSystemPrompt({ page: 'desktop-project', projectId: 'project-b' }, IDENTITY);
  const afterMore = getCacheMetrics();
  assert.equal(afterMore.staticBuilds, 1, '换 context 不得重建静态模板（否则 cache 友好分层名不副实）');
  assert.ok(afterMore.staticCacheHits >= 2, `动态构建应命中静态缓存（实际 ${afterMore.staticCacheHits}）`);

  invalidateStaticCache();
  buildSystemPrompt({ page: 'desktop-home' }, IDENTITY);
  assert.equal(getCacheMetrics().staticBuilds, 2, '显式失效后必须重建一次');
});

test('分段组装报告里 base 段就是那段恒定前缀（计量面与分层一致）', () => {
  invalidateStaticCache();
  const base = buildSystemPrompt(null, IDENTITY);
  const { sections } = buildSystemPromptSections({ page: 'desktop-project', projectId: 'project-a' }, IDENTITY);
  assert.equal(sections[0].name, 'base');
  assert.equal(sections[0].chars, base.length, 'base 段字符数必须等于恒定前缀长度（分层与预算计量不得是两套）');
});
