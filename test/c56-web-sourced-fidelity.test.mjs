/**
 * C-56 网络素材稿件保真契约（2026-11-23）。
 *
 * 用户裁决「从网上爬取素材形成稿件」→ 取 arXiv:1412.3050（开放许可）事实重组。
 * 本测钉死：来源/许可/署名在场 / 不整段复制 / 不编造源文未给的数值 /
 * 四保护 / F 六项 / 未覆盖清单 / provenance。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'acceptance', 'c56-web-sourced-manuscript');
const prov = fs.readFileSync(path.join(DIR, 'source-provenance.md'), 'utf8');
const draft = fs.readFileSync(path.join(DIR, 'manuscript-draft.md'), 'utf8');
const report = fs.readFileSync(path.join(DIR, 'rewrite-report.md'), 'utf8');

test('来源/许可/署名可复核', () => {
  for (const token of ['arXiv:1412.3050', 'Papastamoulis', 'Rattray', 'non-exclusive distribution license', '10.48550', '10.1111/rssc.12213', '2026-11-23']) {
    assert.ok(prov.includes(token), `provenance 须含 ${token}`);
  }
  assert.match(draft, /arXiv:1412\.3050|source-provenance/);
});

test('不整段复制：稿件为中文重组，非英文摘要逐句翻译', () => {
  assert.ok(!draft.includes('Recent advances in molecular biology'), '不得复制英文摘要原句');
  assert.ok((draft.match(/[一-龥]/g) || []).length >= 200, '稿件须为中文重组（中文字符≥200）');
  assert.match(prov, /不整段复制|非原文翻译/);
});

test('不编造数字：源摘要未给的数值一律不出现在稿件性能声明中', () => {
  // 源摘要无样本量/性能数值；稿件不得出现具体性能数字（采样器/条件数等源文确有除外）。
  assert.ok(!/\d+\.\d+\s*%/ .test(draft), '不得编造百分比性能');
  assert.ok(!/\bp\s*[<>=]\s*0?\.\d+/.test(draft), '不得编造 p 值');
  assert.match(draft, /未覆盖/);
  assert.match(report, /未编造数字确认/);
});

test('源文确有的数字/名称逐字符保持（中文译名须与英文原名同现于 provenance/报告）', () => {
  for (const token of ['BitSeq', 'github.com/mqbssppe/cjBitSeq']) {
    assert.ok(draft.includes(token), `稿件须保留 ${token}`);
    assert.ok(report.includes(token), `报告锁定清单须含 ${token}`);
  }
  // 采样器名：稿件可用中文译名，但报告锁定清单须保留英文原名字面（源文事实不丢失）。
  assert.ok(draft.includes('可逆跳跃 MCMC') && draft.includes('折叠 Gibbs'), '稿件须保留两类采样器译名');
  assert.ok(report.includes('reversible jump MCMC') && report.includes('collapsed Gibbs'), '报告须锁定英文原名');
  assert.ok(prov.includes('two biological conditions') && prov.includes('Two samplers'), 'provenance 须留英文原文字面');
});

test('四保护 + F 六项 + 未覆盖 + provenance', () => {
  for (const token of ['确定程度', '归因', '完成状态', '数字锁定']) assert.ok(report.includes(token), `须含保护 ${token}`);
  for (let i = 1; i <= 6; i += 1) assert.ok(report.includes(`F${i}`), `须含 F${i}`);
  assert.match(report, /未覆盖清单|〈未覆盖：/);
  assert.match(report, /provenance|改动动机标签/);
  assert.match(report, /不判断|归人/, '学术判断归人');
});

test('不覆盖输入 + 红线', () => {
  assert.match(draft, /两项任务|联合估计/, '输入重组稿原句须仍在（报告不改输入）');
  assert.match(report, /不覆盖输入/);
  const scheme = fs.readFileSync(path.join(ROOT, 'src/main/pack-ui/scheme.js'), 'utf8');
  assert.match(scheme, /protocol\.handle\(SCHEME/, '产品 handler 未改');
});
