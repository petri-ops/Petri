// U 类裁决材料消费测试（HK-01 红绿先行）。
// 材料必须：声明 pending、含三方案对照与单一推荐、列出 navyLadder 硬红约束、
// 不擅自改代码、不改 status 为 decided。篡改负测 fail-closed。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'U-DECISION-MATERIAL.md');
const read = () => fs.readFileSync(FILE, 'utf8');
const setStatus = (text, value) => text.replace(/status:\s*[a-z_]+/, `status: ${value}`);

describe('U-skeleton-per-accent decision material', () => {
  it('material exists and is pending_user_ruling', () => {
    const m = read();
    assert.match(m, /status:\s*pending_user_ruling/);
  });

  it('contains three options and exactly one recommendation', () => {
    const m = read();
    for (const tag of ['方案 A', '方案 B', '方案 C']) assert.ok(m.includes(tag), `missing ${tag}`);
    assert.match(m, /推荐方案 B/);
    assert.equal((m.match(/\*\*推荐/g) || []).length, 1, 'only one recommendation block allowed');
  });

  it('records the navyLadder hard-red constraint with evidence', () => {
    const m = read();
    assert.match(m, /navyLadder/);
    assert.match(m, /scripts\/c53-visual-consistency\.mjs:109-126/);
    assert.match(m, /必红|硬红/);
  });

  it('records accent/theme orthogonality contract', () => {
    const m = read();
    assert.match(m, /accents\.ts:4-7/);
    assert.match(m, /ThemeProvider\.tsx:251-272/);
  });

  it('no code change claimed and not self-decided', () => {
    const m = read();
    assert.match(m, /本材料\*\*不改代码\*\*/);
    assert.doesNotMatch(m, /status:\s*decided/);
  });

  it('tamper: status flipped to decided → red', () => {
    assert.equal(setStatus(read(), 'decided').includes('status: decided'), true);
    assert.doesNotMatch(setStatus(read(), 'decided'), /status:\s*pending_user_ruling/);
  });
});
