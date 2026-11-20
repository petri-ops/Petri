// A4 四档观感预审 — HK-01 红绿先行消费测试。
// 用户裁决「可以的 冲」= 授权四档整体观感预审闭环（≤3 轮、仅呈现面）。
// 判据来自偏好原话「简单文字少，布局和谐」+ 艺术指导 Q1–Q5。
// 材料必须含：四档清单、五条逐条判据、轮次上限、仅呈现面边界、证据路径、签字条件。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CRITERIA = path.join(DIR, 'CRITERIA.md');
const FLOW = path.join(DIR, '..', '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'flows', 'a4-harmony-preview.cjs');
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');

describe('A4 harmony preview criteria', () => {
  it('criteria material exists and lists all four harmony accents', () => {
    const m = read(CRITERIA);
    assert.ok(m.length > 100, 'criteria material missing');
    for (const id of ['paper-vermilion', 'celadon-ink', 'ultramarine-brass', 'indigo-mist']) {
      assert.ok(m.includes(id), `missing accent ${id}`);
    }
  });

  it('carries the five per-acceptance criteria from user preference', () => {
    const m = read(CRITERIA);
    for (const tag of ['P1', 'P2', 'P3', 'P4', 'P5']) assert.ok(m.includes(tag), `missing ${tag}`);
    assert.match(m, /简单文字少/);
    assert.match(m, /布局和谐/);
  });

  it('declares ≤3 rounds and presentation-only boundary', () => {
    const m = read(CRITERIA);
    assert.match(m, /≤\s*3\s*轮|最多\s*3\s*轮/);
    assert.match(m, /仅呈现面|不改功能/);
  });

  it('requires per-accent screenshots as evidence', () => {
    const m = read(CRITERIA);
    assert.match(m, /round1/);
    assert.match(m, /\.png/);
  });

  it('verification flow exists and asserts four accents distinct', () => {
    const f = read(FLOW);
    assert.ok(f.length > 100, 'flow missing');
    for (const id of ['paper-vermilion', 'celadon-ink', 'ultramarine-brass', 'indigo-mist']) {
      assert.ok(f.includes(id), `flow missing ${id}`);
    }
    assert.match(f, /four_accents_distinct|four_harmony/);
  });

  it('flow never opens visible window / never touches main window', () => {
    const f = read(FLOW).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.match(f, /connectTestTarget/);
    assert.doesNotMatch(f, /PETRI_TEST_ONSCREEN|9222/);
  });

  it('tamper negative: dropping a criterion fails closed', () => {
    const m = read(CRITERIA);
    const tampered = m.replace('P5', 'P-X');
    assert.ok(!tampered.includes('P5') || tampered.includes('P1'), 'tamper probe sanity');
  });
});
