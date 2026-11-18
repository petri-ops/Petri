import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import {
  collectVisualConsistency,
  validateVisualConsistencyIntegrity,
  scanNavyLadder,
  scanSlateFamily,
  scanColorBudget,
  scanTokenIntegrity,
  READING_IDS,
  NAVY_LADDER_SPEC,
  SLATE_PATTERNS,
  SLATE_RATCHET,
} from '../scripts/c53-visual-consistency.mjs';

// BLOCK-472 / C-53 S2 P3 — HK-01 红绿先行 + 篡改负测。
// 视觉一致性契约必须从 custom.css 暗色块 / 全源机械派生并被本测试锚定：
// ① 快照四组读数现读一致（可复算）② 海军蓝阶梯严格单调+规范值对齐
// ③ 广谱 slate ratchet 新增即红 ④ 颜色预算现读对账 ⑤ token 完整性
// ⑥ manifest sha256 ⑦ 篡改负测 fail-closed ⑧ P0/P1/P2 包零回归。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = path.join(ROOT, 'acceptance/block472-c53-p3-visual-consistency/visual-consistency-snapshot.json');
const CONTRACT = path.join(ROOT, 'resources/design-context/visual-consistency.json');
const MANIFEST = path.join(ROOT, 'resources/design-context/manifest.json');
const CUSTOM_CSS = path.join(ROOT, 'frontend/src/styles/custom.css');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const ownGet = (obj, key) => Object.entries(obj ?? {}).find(([k]) => k === key)?.[1];

describe('C-53 P3 视觉一致性契约可复算（HK-01）', () => {
  it('快照与契约在场且结构完整（四组读数带 value/source/command/capturedAt）', () => {
    assert.equal(fs.existsSync(SNAPSHOT), true, 'visual-consistency-snapshot.json 必须在场');
    assert.equal(fs.existsSync(CONTRACT), true, 'visual-consistency.json 必须在场');
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    assert.equal(snap.kind, 'c53-visual-consistency');
    assert.deepEqual(Object.keys(snap.readings).sort(), [...READING_IDS].sort());
    const check = validateVisualConsistencyIntegrity(snap.readings);
    assert.equal(check.ok, true, `完整性: ${check.issues.join('; ')}`);
  });

  it('逐读数现读一致（collectVisualConsistency 重算与落盘 value 深等）', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const fresh = collectVisualConsistency(ROOT);
    for (const id of READING_IDS) {
      assert.deepEqual(
        ownGet(fresh, id).value,
        ownGet(snap.readings, id).value,
        `读数 ${id} 与现真源漂移（快照过期或真源变更未重算）`,
      );
    }
  });

  it('海军蓝暗色阶梯：四档明度严格递增且取值对齐规范', () => {
    const css = fs.readFileSync(CUSTOM_CSS, 'utf8');
    const ladder = scanNavyLadder(css);
    assert.equal(ladder.ascending, true, `阶梯非严格递增: ${JSON.stringify(ladder.tiers)}`);
    assert.equal(ladder.specAligned, true, `阶梯取值未对齐规范: ${JSON.stringify(ladder.tiers)}`);
    assert.equal(ladder.tiers.length, 4);
    assert.deepEqual(ladder.tiers.map((t) => t.hex), [...NAVY_LADDER_SPEC]);
    for (let i = 1; i < ladder.tiers.length; i++) {
      assert.ok(ladder.tiers.at(i).luminance > ladder.tiers.at(i - 1).luminance, '明度必须逐档递增');
    }
  });

  it('广谱 slate ratchet：现读命中不超冻结基线（存量入册、新增即红）', () => {
    const slip = scanSlateFamily(ROOT);
    const frozen = slip.overRatchet;
    assert.deepEqual(frozen, [], `出现超出冻结基线的 slate 命中: ${JSON.stringify(frozen)}`);
    assert.ok(SLATE_PATTERNS.length >= 11, '广谱家族成员 ≥11');
    assert.ok(Object.keys(SLATE_RATCHET).length > 0, '冻结基线非空');
  });

  it('颜色预算：accent 现读总数与落盘一致，终态未达如实标注', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const fresh = scanColorBudget(ROOT);
    const frozen = ownGet(snap.readings, 'colorBudget').value;
    assert.equal(fresh.total, frozen.total, 'accent 现读总数须与落盘一致');
    assert.equal(fresh.targetMet, false, '终态 ≤130 当前未达，必须如实标 false');
    assert.ok(fresh.total > fresh.declaredCeiling, '现状总数仍高于终态目标');
  });

  it('token 完整性：零 var(--color-*) 引用 + 零未定义 --petri-* 引用', () => {
    const integrity = scanTokenIntegrity(ROOT);
    assert.deepEqual(integrity.undefinedColorRefs, []);
    assert.deepEqual(integrity.missingPetriRefs, []);
  });

  it('manifest sha256 与 visual-consistency.json 实际字节一致', () => {
    const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const entry = (m.files || []).find((f) => ownGet(f, 'path') === 'visual-consistency.json');
    assert.ok(entry, 'manifest 必须登记 visual-consistency.json');
    assert.equal(ownGet(entry, 'sha256'), sha256(fs.readFileSync(CONTRACT)), 'sha256 一致');
  });

  it('篡改负测 fail-closed：改阶梯值/改契约读数/改哈希都被判红', () => {
    // 改阶梯 hex → 规范对齐失败
    const css = fs.readFileSync(CUSTOM_CSS, 'utf8');
    const forgedCss = css.replace('--petri-bg-canvas: #0b1220', '--petri-bg-canvas: #ffffff');
    assert.equal(scanNavyLadder(forgedCss).specAligned, false, '篡改阶梯值必红');

    // 插超 ratchet 的 slate 命中 → overRatchet 非空（通过注入 sources 验证纯函数）
    const injected = { 'components/__forged__.css': '#1e293b' };
    const slip = scanSlateFamily(ROOT, injected);
    assert.ok(slip.overRatchet.length > 0, '注入新 slate 命中必红');

    // 结构完整性：抽掉一组读数 → 红
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const broken = structuredClone(snap.readings);
    delete broken.colorBudget;
    assert.equal(validateVisualConsistencyIntegrity(broken).ok, false, '缺读数必红');

    // 契约读数漂移 → 与落盘深等失败
    const forged = structuredClone(snap.readings);
    ownGet(forged, 'colorBudget').value.total = 1;
    assert.notDeepEqual(ownGet(forged, 'colorBudget').value, ownGet(collectVisualConsistency(ROOT), 'colorBudget').value);
  });

  it('P0/P1/P2 包零回归：design-context.json + ia-map.json 仍在场', () => {
    const dir = path.join(ROOT, 'resources/design-context');
    assert.equal(fs.existsSync(path.join(dir, 'design-context.json')), true, 'P1 包不得被破坏');
    assert.equal(fs.existsSync(path.join(dir, 'ia-map.json')), true, 'P2 包不得被破坏');
  });
});
