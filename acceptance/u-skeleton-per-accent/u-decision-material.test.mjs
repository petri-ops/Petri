// U 类裁决材料消费测试（HK-01 红绿先行）。
// 材料必须：含三方案对照与单一推荐、列出 navyLadder 硬红约束、不擅自改代码、
// 状态与裁决真值一致（2026-11-21 R2 清偿批 S4/P1-5 契约演进：方案 B 已裁决并执行，
// status 从 pending_user_ruling 演进为 ruled + rulingPointer，测试追上契约——
// 原「永久 pending 锚」让待裁清单虚挂真实已裁项）。篡改负测 fail-closed。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'U-DECISION-MATERIAL.md');
const RULING = path.join(path.dirname(fileURLToPath(import.meta.url)), 'RULING.md');
const read = () => fs.readFileSync(FILE, 'utf8');
const setStatus = (text, value) => text.replace(/status:\s*[a-z_]+/, `status: ${value}`);

describe('U-skeleton-per-accent decision material', () => {
  it('material exists and status matches ruling truth (ruled + pointer)', () => {
    const m = read();
    assert.match(m, /status:\s*ruled/);
    assert.match(m, /rulingPointer:.*RULING\.md/);
    // 裁决真源在场且为 append-only 记录
    const r = fs.readFileSync(RULING, 'utf8');
    assert.match(r, /"kind":\s*"u-class-ruling"/);
    assert.match(r, /采纳方案 B/);
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

  it('tamper: status flipped to decided → red（裁决状态只能 ruled，不得自裁 decided）', () => {
    const m = setStatus(read(), 'decided');
    assert.match(m, /status:\s*decided/);
    // decided 不是合法状态：裁决必须出自用户（RULING.md），材料只能 ruled 指向它
    assert.doesNotMatch(m, /status:\s*ruled/);
  });
});
