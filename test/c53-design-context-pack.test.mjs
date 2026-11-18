import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import {
  collectDesignBaseline,
  validateBaselineIntegrity,
  READING_IDS,
} from '../scripts/c53-design-baseline.mjs';

// BLOCK-465 / C-53 S1 — HK-01 红绿先行。
// 消费测试：design-context 上下文包必须由真源机械派生，且被本测试锚定——
// ① 快照 readings 与现真源逐读数一致（可复算）② 包正文派生自同一批读数
// ③ manifest sha256 与文件一致 ④ 篡改负测 fail-closed。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = path.join(ROOT, 'acceptance/block465-c53-p0p1/design-baseline.json');
const PACK_DIR = path.join(ROOT, 'resources/design-context');
const PACK = path.join(PACK_DIR, 'design-context.json');
const MANIFEST = path.join(PACK_DIR, 'manifest.json');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
// own-enumerable 查找（BLOCK-456 先例）：键来自冻结 READING_IDS，避免原型链命中告警。
const ownGet = (obj, key) => Object.entries(obj).find(([k]) => k === key)?.[1];

describe('C-53 S1 设计基线快照可复算（P0）', () => {
  it('快照文件在场且结构完整（每条冻结读数带 value/source/command/capturedAt）', () => {
    assert.equal(fs.existsSync(SNAPSHOT), true, 'design-baseline.json 必须在场');
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    assert.equal(snap.kind, 'c53-design-baseline');
    assert.deepEqual(Object.keys(snap.readings).sort(), [...READING_IDS].sort());
    const check = validateBaselineIntegrity(snap.readings);
    assert.equal(check.ok, true, `完整性: ${check.issues.join('; ')}`);
    // 捕获时状态留痕：快照取自干净态（无 🔴/🟢），不参与冻结比对。
    assert.equal(snap.captureContext.auditUnresolved.value.total, 0);
    assert.equal(snap.captureContext.registry.value.activeWorkPackages.includes('BLOCK-465'), true);
  });

  it('逐读数现读一致（collectDesignBaseline 重算与落盘 value 深等）', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const fresh = collectDesignBaseline(ROOT);
    for (const id of READING_IDS) {
      assert.deepEqual(
        ownGet(fresh, id).value,
        ownGet(snap.readings, id).value,
        `读数 ${id} 与现真源漂移（快照过期或真源变更未重算）`,
      );
    }
  });

  it('负测：结构坏源（null 子字段/缺字段）被完整性校验拒绝', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const broken = structuredClone(snap.readings);
    broken.fontTiers.value = { ...broken.fontTiers.value, count: null };
    assert.equal(validateBaselineIntegrity(broken).ok, false);
    const missing = structuredClone(snap.readings);
    delete missing.colorBudget.value;
    assert.equal(validateBaselineIntegrity(missing).ok, false);
    // 数值漂移不靠结构校验，而靠上一用例的逐读数深等断言——两层职责正交。
    const numericDrift = structuredClone(snap.readings);
    numericDrift.uiDebt.value = { ...numericDrift.uiDebt.value, debt: 999 };
    assert.equal(validateBaselineIntegrity(numericDrift).ok, true, '结构完整但数值漂移：由深等断言兜底');
    assert.notDeepEqual(numericDrift.uiDebt.value, collectDesignBaseline(ROOT).uiDebt.value);
  });
});

describe('C-53 S1 设计上下文包被消费测试锚定（P1）', () => {
  it('上下文包与 manifest 在场，schema/生成器声明正确', () => {
    assert.equal(fs.existsSync(PACK), true, 'design-context.json 必须在场');
    assert.equal(fs.existsSync(MANIFEST), true, 'manifest.json 必须在场');
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.generator, 'node scripts/c53-design-baseline.mjs');
    const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'));
    assert.equal(pack.id, 'petri-design-context-pack');
    assert.equal(pack.schemaVersion, 1);
  });

  it('manifest sha256 与 design-context.json 实际字节一致', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const actual = sha256(fs.readFileSync(PACK));
    const entry = manifest.files.find((f) => f.path === 'design-context.json');
    assert.ok(entry, 'manifest 必须登记 design-context.json');
    assert.equal(entry.sha256, actual, 'manifest sha256 漂移');
  });

  it('包正文派生自现真源读数（font/color/border/motion/controls/ratchet/uiDebt 逐项深等）', () => {
    const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'));
    const fresh = collectDesignBaseline(ROOT);
    assert.deepEqual(pack.font, fresh.fontTiers.value);
    assert.deepEqual(pack.color, fresh.colorBudget.value);
    assert.deepEqual(pack.border, fresh.borderSemantics.value);
    assert.deepEqual(pack.motion, fresh.motion.value);
    assert.deepEqual(pack.controls, fresh.controls.value);
    assert.deepEqual(pack.ratchets, fresh.ratchets.value);
    assert.deepEqual(pack.uiDebt, fresh.uiDebt.value);
  });

  it('人眼边界如实声明（观感不代签，pack 只读不改运行时）', () => {
    const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'));
    assert.equal(pack.boundaries.humanEyeSigned, false);
    assert.equal(pack.boundaries.readOnly, true);
    assert.match(pack.boundaries.note, /pending_human_eye/);
  });

  it('负测：篡改包正文后与真源深等断言失败（消费测试锚有效）', () => {
    const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'));
    const fresh = collectDesignBaseline(ROOT);
    const forged = structuredClone(pack);
    forged.uiDebt = { ...forged.uiDebt, debt: 1 };
    assert.notDeepEqual(
      forged.uiDebt,
      fresh.uiDebt.value,
      '篡改值必须与真源不等（否则消费测试失去锚定力）',
    );
  });
});
