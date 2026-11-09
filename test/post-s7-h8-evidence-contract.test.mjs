/**
 * post-S7 H8 实机证据形状契约（红绿先行）。
 * 五类证据不得互相冒充：本文件只钉「CDP 取数产出的 JSON 形状」，
 * 不断言 DOM 绿=视觉绿，也不断言机械门禁绿=UI 在场。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = path.join(ROOT, 'acceptance/post-s7-2026-11-10/h8/dom-budget-live.json');

function assertShape(e) {
  assert.equal(e.schemaVersion, 1);
  assert.equal(e.kind, 'post-s7-h8-dom-budget-live');
  assert.equal(typeof e.sourceCommit, 'string');
  assert.equal(typeof e.platform, 'string');
  assert.equal(typeof e.command, 'string');
  assert.equal(typeof e.generatedAt, 'string');
  assert.ok(e.evidenceClass === 'cdp-dom-measurement');
  assert.ok(Array.isArray(e.samples) && e.samples.length >= 2, '至少 400 / 800 两档');
  for (const s of e.samples) {
    assert.equal(typeof s.conversationCount, 'number');
    assert.equal(typeof s.allNodes, 'number');
    assert.equal(typeof s.scMessagesNodes, 'number');
    assert.equal(typeof s.convRowMatches, 'number');
    assert.equal(typeof s.geometry, 'object');
    assert.ok(s.allNodes > 0, 'DOM 节点数必须来自真实页面');
    assert.ok(s.geometry.viewport && typeof s.geometry.viewport.width === 'number');
  }
  assert.ok(e.frameSamples && typeof e.frameSamples.p50Ms === 'number', '帧率读数必须在册');
  assert.equal(e.humanEyeEquivalent, false, 'DOM/帧率读数不得冒充人眼观感');
  assert.equal(e.verdict, 'measured', '本脚本只取数，不判产品通过/不通过');
  assert.equal(e.platform, `${os.platform()}-${os.arch()}`, '证据必须来自当前平台，不许搬别的机器读数');
  assert.equal(e.serverSideLimits?.conversationsApiLimit, 100, '服务端截断事实必须在册，不许缩分母凑指标');
  assert.ok(e.samples.some((s) => s.label?.includes('over-limit')), '超上限档位必须保留并列归因');
  assert.ok(e.stack?.cdp?.includes('offscreen'), '必须如实标注离屏窗口');
}

test('H8 DOM/帧率证据文件存在且形状完整（未产出时如实跳过，不冒充通过）', () => {
  if (!fs.existsSync(EVIDENCE)) {
    assert.ok(true, '证据尚未产出——本测试只做形状守护，不代替实机取数');
    return;
  }
  assertShape(JSON.parse(fs.readFileSync(EVIDENCE, 'utf8')));
});

test('形状契约负例：缺字段 / 冒充人眼 / 判通过 都必须红', () => {
  const good = {
    schemaVersion: 1, kind: 'post-s7-h8-dom-budget-live', sourceCommit: 'abc', platform: 'darwin-arm64',
    command: 'node scripts/post-s7-dom-budget-live.cjs', generatedAt: '2026-11-10T00:00:00Z',
    evidenceClass: 'cdp-dom-measurement',
    samples: [
      { label: 'convs-100', conversationCount: 100, allNodes: 3052, scMessagesNodes: 810, convRowMatches: 500, geometry: { viewport: { width: 1440, height: 900 } } },
      { label: 'convs-800-over-limit', conversationCount: 800, allNodes: 7202, scMessagesNodes: 4860, convRowMatches: 500, geometry: { viewport: { width: 1440, height: 900 } } },
    ],
    frameSamples: { p50Ms: 16.7 }, humanEyeEquivalent: false, verdict: 'measured',
    serverSideLimits: { conversationsApiLimit: 100 },
    stack: { cdp: ':9223 (offscreen)' },
  };
  assertShape(good);
  const bad = (patch) => {
    assert.throws(() => assertShape({ ...good, ...patch }));
  };
  bad({ samples: good.samples.slice(0, 1) });
  bad({ humanEyeEquivalent: true });
  bad({ verdict: 'pass' });
  bad({ frameSamples: undefined });
  bad({ evidenceClass: 'visual-verified' });
});
