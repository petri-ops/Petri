/**
 * BLOCK-192 — real 模式凭据自给契约测（纯函数 + 源码守卫，零真模型调用、零明文外泄）。
 * 守：①env 显式优先且不触碰本机读取器；②mock 模式绝不回落（真 key 不入临时文件）；
 *     ③real 回落用预设+凭据库单源且补 provider→baseUrl 缺省；④解析失败给 skipReason 不伪造；
 *     ⑤返回值脱敏（调用侧只见 hasKey，永不见 apiKey）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveRealProviderSettings, parseActivePreset, PROVIDER_DEFAULT_BASE_URL, sanitizeEvalTasksForStorage } from '../scripts/lib/evals-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEEPSEEK_SETTINGS = {
  active_chat_model_id: 'deepseek-chat',
  chat_model_presets: [{ id: 'deepseek-chat', provider: 'deepseek', model: 'deepseek-chat' }],
};

test('env 显式 key 优先，且完全不调用本机读取器（向后兼容零变更）', () => {
  const boom = () => { throw new Error('不应被调用'); };
  const r = resolveRealProviderSettings({
    mode: 'real',
    env: { PETRI_EVALS_PROVIDER_KEY: 'env-key', PETRI_EVALS_BASE_URL: 'https://x/v1', PETRI_EVALS_MODEL: 'm1' },
    readSettings: boom, getCredential: boom,
  });
  assert.equal(r.source, 'env');
  assert.equal(r.apiKey, 'env-key');
  assert.equal(r.baseUrl, 'https://x/v1');
  assert.equal(r.model, 'm1');
});

test('mock 模式绝不回落本机凭据库（真 key 不得被写进临时目录）', () => {
  const boom = () => { throw new Error('mock 模式不得读本机凭据'); };
  const r = resolveRealProviderSettings({ mode: 'mock', env: {}, readSettings: boom, getCredential: boom });
  assert.equal(r.apiKey, null);
  assert.equal(r.source, 'none');
  assert.equal(r.skipReason, null);
});

test('env 的 baseUrl/model 与 mode 无关都要透传（回归守卫：mock 指向本地 mock server 靠它）', () => {
  const r = resolveRealProviderSettings({
    mode: 'mock',
    env: { PETRI_EVALS_BASE_URL: 'http://127.0.0.1:9999/v1', PETRI_EVALS_MODEL: 'mock-1' },
    readSettings: () => DEEPSEEK_SETTINGS, getCredential: () => 'should-not-be-used',
  });
  assert.equal(r.baseUrl, 'http://127.0.0.1:9999/v1', 'mock 丢 baseUrl 会让请求打到死占位地址、真模型链静默失败');
  assert.equal(r.model, 'mock-1');
  assert.equal(r.apiKey, null);
});

test('real 回落到凭据库：provider→baseUrl 缺省补齐 + 取 model', () => {
  const r = resolveRealProviderSettings({
    mode: 'real', env: {},
    readSettings: () => DEEPSEEK_SETTINGS,
    getCredential: (p) => (p === 'deepseek' ? 'stored-key' : ''),
  });
  assert.equal(r.source, 'local-store');
  assert.equal(r.apiKey, 'stored-key');
  assert.equal(r.baseUrl, PROVIDER_DEFAULT_BASE_URL.deepseek);
  assert.match(r.baseUrl, /\/v1$/);
  assert.equal(r.model, 'deepseek-chat');
});

test('解析失败三类均给 skipReason 且不产 key（诚实 skip，不伪造真模型结果）', () => {
  const cases = [
    { name: '无预设', read: () => ({}), cred: () => 'x', hint: '预设' },
    { name: '有预设无 key', read: () => DEEPSEEK_SETTINGS, cred: () => '', hint: 'deepseek' },
    { name: '未知 provider 无 baseUrl', read: () => ({ active_chat_model_id: 'z', chat_model_presets: [{ id: 'z', provider: 'mystery', model: 'm' }] }), cred: () => 'x', hint: 'baseUrl' },
  ];
  for (const c of cases) {
    const r = resolveRealProviderSettings({ mode: 'real', env: {}, readSettings: c.read, getCredential: c.cred });
    assert.equal(r.apiKey, null, `${c.name} 不得给 key`);
    assert.ok(r.skipReason && r.skipReason.length > 0, `${c.name} 必须给 skipReason`);
    assert.match(r.skipReason, new RegExp(c.hint), `${c.name} skipReason 应含「${c.hint}」`);
  }
});

test('parseActivePreset：按 active id 命中，缺配回落首个；provider 小写归一', () => {
  const two = { active_chat_model_id: 'b', chat_model_presets: [{ id: 'a', provider: 'DeepSeek', model: 'ma', baseUrl: 'https://a' }, { id: 'b', provider: 'openai-compatible', model: 'mb' }] };
  const active = parseActivePreset(two);
  assert.equal(active.model, 'mb');
  assert.equal(active.provider, 'openai-compatible');
  // 无匹配 active id → 回落首个；首个 provider 大小写混合 → 归一并补 baseUrl 缺省映射
  const fallback = parseActivePreset({ active_chat_model_id: 'nope', chat_model_presets: two.chat_model_presets });
  assert.equal(fallback.model, 'ma');
  assert.equal(fallback.provider, 'deepseek');
  assert.equal(fallback.baseUrl, 'https://a', 'preset 自带 baseUrl 时优先用它');
  assert.equal(parseActivePreset({}), null);
  assert.equal(parseActivePreset(null), null);
});

test('入库脱敏：evals 报告/基线只留判据结论，不留模型原文（隐私红线自洽）', () => {
  const out = sanitizeEvalTasksForStorage([{ id: 't', passed: true, finalText: '模型原文……', criteriaResults: [{ kind: 'task_completed', passed: true }] }]);
  assert.equal(out[0].finalText, undefined, 'finalText 必须被剥离');
  assert.equal(out[0].id, 't');
  assert.ok(out[0].criteriaResults.length === 1, '判据结论保留（棘轮仍可比对）');
  // 已入库的真实产物不得含原文字段
  for (const f of ['acceptance/evals/real-latest.json', 'evals/baselines/real.json', 'acceptance/evals/golden-latest.json']) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    assert.doesNotMatch(fs.readFileSync(p, 'utf8'), /"finalText"\s*:/, `${f} 不应持久化模型原文`);
  }
});

test('脱敏守卫：harness 回传结构以 hasKey 表达可得性，源码不得把 resolved.apiKey 打进日志', () => {
  const harness = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'evals-harness.mjs'), 'utf8');
  assert.match(harness, /hasKey:\s*Boolean\(resolved\.apiKey\)/, '返回体只暴露 hasKey');
  assert.doesNotMatch(harness, /console\.(log|error|warn)\([^)]*resolved\.apiKey/, '不得把明文 key 写进日志');
  const runner = fs.readFileSync(path.join(ROOT, 'scripts', 'evals-run.mjs'), 'utf8');
  assert.doesNotMatch(runner, /backend\.provider\.apiKey/, '调用侧不得读取/输出 apiKey');
});
