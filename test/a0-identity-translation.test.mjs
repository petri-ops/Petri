import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  collectIdentityTranslation,
  validateMaterialIntegrity,
  READING_IDS,
} from '../scripts/lib/a0-identity-translation.mjs';

// A0 身份转译决策（专项·结论型）— HK-01 红绿先行。
// 消费测试：决策材料必须由品牌真源机械派生，单一推荐 + 一句理由，
// 且被本测试锚定——① 六组读数在场逐项可复算 ② 材料派生自同一批读数
// ③ 篡改负测 fail-closed（推荐项缺失/多推荐/观感代签/G1 越界/依赖引入/不采纳清单被删）。
// 本包只产结论不产功能：不得翻任何观感状态、不得改产品代码。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MATERIAL = path.join(ROOT, 'acceptance/a0-identity-translation/decision-material.json');
const SCHEMA = path.join(ROOT, 'acceptance/a0-identity-translation/schema.json');

const ownGet = (obj, key) => Object.entries(obj).find(([k]) => k === key)?.[1];

describe('A0 身份转译决策材料完整性（HK-01）', () => {
  it('材料与 schema 在场，六组冻结读数齐全（每条带 value/source）', () => {
    assert.equal(fs.existsSync(MATERIAL), true, 'decision-material.json 必须在场');
    assert.equal(fs.existsSync(SCHEMA), true, 'schema.json 必须在场');
    const m = JSON.parse(fs.readFileSync(MATERIAL, 'utf8'));
    assert.equal(m.kind, 'a0-identity-decision-material');
    assert.deepEqual(Object.keys(m.readings).sort(), [...READING_IDS].sort());
    for (const id of READING_IDS) {
      const row = ownGet(m.readings, id);
      assert.ok(row && 'value' in row && 'source' in row, `${id} 必须带 value/source`);
    }
    const check = validateMaterialIntegrity(m.readings);
    assert.equal(check.ok, true, `完整性: ${check.issues.join('; ')}`);
  });

  it('逐读数现读一致（collectIdentityTranslation 重算与落盘深等）', () => {
    const m = JSON.parse(fs.readFileSync(MATERIAL, 'utf8'));
    const fresh = collectIdentityTranslation(ROOT);
    for (const id of READING_IDS) {
      assert.deepEqual(
        ownGet(fresh, id).value,
        ownGet(m.readings, id).value,
        `读数 ${id} 与真源漂移`,
      );
    }
  });

  it('单一推荐 + 一句理由（用户裁决 2026-11-20「一个建议+一句理由」）', () => {
    const m = JSON.parse(fs.readFileSync(MATERIAL, 'utf8'));
    const rec = ownGet(m.readings, 'recommendation').value;
    assert.equal(rec.options.length, 1, '只允许一个推荐方案，禁止多选菜单');
    assert.equal(rec.reasons.length, 1, '只允许一句理由');
    assert.equal(rec.status, 'pending_user_ruling', '未裁决前不得写 decided/verified');
  });

  it('观感与代码边界守住：零代签/零产品代码/零新依赖/不碰 G1+', () => {
    const m = JSON.parse(fs.readFileSync(MATERIAL, 'utf8'));
    const b = ownGet(m.readings, 'boundaries').value;
    assert.equal(b.humanEyeStatus, 'in_progress');
    assert.equal(b.productCodeChanges, 0);
    assert.equal(b.newDependencies, 0);
    assert.equal(b.g1Touched, false);
  });

  it('不采纳清单含玻璃/视差/胶片颗粒（跨学科方案的硬拒绝项）', () => {
    const m = JSON.parse(fs.readFileSync(MATERIAL, 'utf8'));
    const r = ownGet(m.readings, 'refusals').value;
    for (const token of ['glassmorphism', 'parallax', 'film-grain']) {
      assert.ok(r.refused.includes(token), `拒绝清单缺 ${token}`);
    }
  });

  const setVal = (readings, id, value) => {
    const clone = structuredClone(readings);
    ownGet(clone, id).value = value;
    return clone;
  };

  it('负测：推荐项被删 → 红', () => {
    const base = JSON.parse(fs.readFileSync(MATERIAL, 'utf8')).readings;
    const rec = structuredClone(ownGet(base, 'recommendation').value);
    rec.options = [];
    assert.equal(validateMaterialIntegrity(setVal(base, 'recommendation', rec)).ok, false);
  });

  it('负测：多推荐选项 → 红', () => {
    const base = JSON.parse(fs.readFileSync(MATERIAL, 'utf8')).readings;
    const rec = structuredClone(ownGet(base, 'recommendation').value);
    rec.options.push('C-群青·铜');
    assert.equal(validateMaterialIntegrity(setVal(base, 'recommendation', rec)).ok, false);
  });

  it('负测：观感状态翻 verified → 红', () => {
    const base = JSON.parse(fs.readFileSync(MATERIAL, 'utf8')).readings;
    const b = structuredClone(ownGet(base, 'boundaries').value);
    b.humanEyeStatus = 'verified';
    assert.equal(validateMaterialIntegrity(setVal(base, 'boundaries', b)).ok, false);
  });

  it('负测：引入产品级依赖 → 红', () => {
    const base = JSON.parse(fs.readFileSync(MATERIAL, 'utf8')).readings;
    const b = structuredClone(ownGet(base, 'boundaries').value);
    b.newDependencies = 1;
    assert.equal(validateMaterialIntegrity(setVal(base, 'boundaries', b)).ok, false);
  });

  it('负测：不采纳清单被删 → 红', () => {
    const base = JSON.parse(fs.readFileSync(MATERIAL, 'utf8')).readings;
    const r = structuredClone(ownGet(base, 'refusals').value);
    r.refused = ['glassmorphism'];
    assert.equal(validateMaterialIntegrity(setVal(base, 'refusals', r)).ok, false);
  });

  it('负测：G1+ 被混入 → 红', () => {
    const base = JSON.parse(fs.readFileSync(MATERIAL, 'utf8')).readings;
    const b = structuredClone(ownGet(base, 'boundaries').value);
    b.g1Touched = true;
    assert.equal(validateMaterialIntegrity(setVal(base, 'boundaries', b)).ok, false);
  });

  it('负测：status 被改成 decided → 红', () => {
    const base = JSON.parse(fs.readFileSync(MATERIAL, 'utf8')).readings;
    const rec = structuredClone(ownGet(base, 'recommendation').value);
    rec.status = 'decided';
    assert.equal(validateMaterialIntegrity(setVal(base, 'recommendation', rec)).ok, false);
  });
});
