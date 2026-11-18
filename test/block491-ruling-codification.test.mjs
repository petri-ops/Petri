import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import {
  collectRulingCodification,
  validateRulingCodificationIntegrity,
  scanRulings,
  scanBoundaries,
  RULING_IDS,
  RULING_FORM,
  DEFERRED_TICKETS,
  READING_IDS,
} from '../scripts/block491-ruling-codification.mjs';

// BLOCK-491 · BLOCK-322-RULING D1–D5 裁决固化（HK-01 红绿先行 + 篡改负测）。
// 只固化裁决材料 + 冻结边界，不实现任何几何/SceneSpec 契约变更。
// ① 契约/快照结构完整 ② 逐读数现读一致 ③ 五裁决逐项 ④ 派生缓存与禁 OCCT 建几何
// ⑤ 引用白名单加键 ⑥ 实现票 deferred ⑦ GD&T 数值判据 ⑧ 边界 ⑨ manifest sha
// ⑩ 篡改负测 fail-closed ⑪ 零回归基线。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = path.join(ROOT, 'acceptance/block491-ruling-codification/ruling-codification-snapshot.json');
const CONTRACT = path.join(ROOT, 'resources/ruling-codification/block322-ruling-codification.json');
const MANIFEST = path.join(ROOT, 'acceptance/block491-ruling-codification/manifest.json');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const ownGet = (obj, key) => Object.entries(obj ?? {}).find(([k]) => k === key)?.[1];

describe('BLOCK-491 RULING D1–D5 裁决固化契约可复算（HK-01）', () => {
  it('缺席红：扫描器 / 契约 / 快照三件必须全部在场', () => {
    assert.equal(fs.existsSync(SNAPSHOT), true, 'ruling-codification-snapshot.json 必须在场（HK-01 缺席红）');
    assert.equal(fs.existsSync(CONTRACT), true, 'block322-ruling-codification.json 契约必须在场');
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    assert.equal(snap.kind, 'block491-ruling-codification');
    assert.deepEqual(Object.keys(snap.readings).sort(), [...READING_IDS].sort());
    const check = validateRulingCodificationIntegrity(snap.readings);
    assert.equal(check.ok, true, `完整性: ${check.issues.join('; ')}`);
  });

  it('逐读数现读一致（collect 重算与落盘 value 深等）', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const fresh = collectRulingCodification(ROOT);
    for (const id of READING_IDS) {
      assert.deepEqual(
        ownGet(fresh, id).value,
        ownGet(snap.readings, id).value,
        `读数 ${id} 与现真源漂移（快照过期或真源变更未重算）`,
      );
    }
  });

  it('五裁决逐项：D1–D5 全部在场、形态值与用户裁决一致、状态 ruled', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const s = ownGet(snap.readings, 'rulings').value;
    assert.deepEqual(Object.keys(s.rulings).sort(), [...RULING_IDS].sort());
    for (const id of RULING_IDS) {
      const r = ownGet(s.rulings, id);
      assert.equal(r.status, 'ruled', `${id} 必须为 ruled`);
      assert.equal(r.form, ownGet(RULING_FORM, id), `${id} 形态值须与用户裁决一致`);
      assert.equal(r.hasUserQuote, true, `${id} 必须附用户裁决原话`);
      assert.equal(r.ruledAt, '2026-11-18');
    }
  });

  it('D1 派生缓存 + sha/dimensions 版本键 + 不一致 fail-closed + D3 禁 OCCT 建几何', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const s = ownGet(snap.readings, 'featureIdentity').value;
    assert.equal(s.derivedCache, true, 'D1 必须为派生缓存');
    assert.equal(s.versionKeyShaDimensions, true, '版本键必须是 sourceSha256/dimensions');
    assert.equal(s.mismatchFailClosed, true, '派生表与源不一致必须 fail-closed');
    assert.equal(s.noSecondSourceOfTruth, true, '不得建第二场景真值');
    assert.equal(s.occtReadOnly, true, 'D3：occt-wasm 只读分析');
    assert.equal(s.noOcctBuildGeometry, true, 'D3：严禁用 OCCT 建模 API 建几何（第二执行器）');
  });

  it('D2 新增 aFeature/bFeature 白名单键 + 旧场景零迁移 + 非 nodeId#featureId 字符串', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const s = ownGet(snap.readings, 'referenceSyntax').value;
    assert.equal(s.additiveWhiteListKeys, true, 'D2：白名单加键');
    assert.equal(s.aFeatureBFeature, true, 'D2：新增 aFeature/bFeature');
    assert.equal(s.zeroLegacyMigration, true, 'D2：旧场景零迁移');
    assert.equal(s.notNodeIdFeatureString, true, 'D2：不采用 nodeId#featureId 字符串改法');
    assert.equal(s.contractChangeDeferred, true, 'SceneSpec 契约变更属后续实现票，本包不落地');
  });

  it('实现票 deferred 逐票：P4-05b / v2a / v2b 待发令，v2c deferred，不随裁决项登记', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const s = ownGet(snap.readings, 'implementationTickets').value;
    assert.deepEqual(Object.keys(s.tickets).sort(), [...DEFERRED_TICKETS].sort());
    for (const id of DEFERRED_TICKETS) {
      assert.equal(ownGet(s.tickets, id).status, 'deferred_user_ruling', `${id} 必须 deferred_user_ruling`);
      assert.equal(ownGet(s.tickets, id).needsUserOrder, true, `${id} 需用户逐票发令`);
    }
    assert.equal(s.v2cSeparated, true, 'v2c 必须单列 deferred');
    assert.equal(s.noImplementationStarted, true, '本包未启动任何实现票');
  });

  it('D5 GD&T 数值一致性判据：标注文本 + 视图投影坐标 + 解析尺寸一致，禁主观像不像', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const s = ownGet(snap.readings, 'gdtAcceptance').value;
    assert.equal(s.annotationText, true, 'D5：标注文本');
    assert.equal(s.viewProjectionCoords, true, 'D5：尺寸两端点视图投影坐标');
    assert.equal(s.numericConsistency, true, 'D5：与解析尺寸数值一致');
    assert.equal(s.noSubjectiveLooksRight, true, 'D5：禁主观「像不像真图纸」');
  });

  it('边界：观感零代签 + 零新依赖 + 不改 SceneSpec 契约 + 零产品写面 + 不碰 G1+', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const s = ownGet(snap.readings, 'boundaries').value;
    assert.equal(s.humanEyeZeroSign, true, '观感四槽必须 in_progress + pending_human_eye + 零 verified');
    assert.equal(s.noNewDependency, true, '零新增产品依赖');
    assert.equal(s.noSceneSpecContractChange, true, '不改 SceneSpec 契约');
    assert.equal(s.noProductCodeWrite, true, '零产品代码写面');
    assert.equal(s.noG1Plus, true, '不碰 Provider/公证/GA/packaged');
  });

  it('manifest sha256 一致 + 契约模型可读标识在场', () => {
    const contractBuf = fs.readFileSync(CONTRACT);
    const contract = JSON.parse(contractBuf);
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const entry = manifest.files.find((f) => ownGet(f, 'path') === 'block322-ruling-codification.json');
    assert.ok(entry, 'manifest 必须登记 block322-ruling-codification.json');
    assert.equal(entry.sha256, sha256(contractBuf), 'manifest sha256 与契约文件不一致');
    assert.equal(contract.kind, 'model-readable-ruling-codification');
    assert.equal(contract.rulingStatus, 'ruled');
    assert.equal(contract.boundaries.readOnly, true);
    assert.equal(contract.boundaries.noImplementation, true);
    assert.equal(contract.boundaries.humanEyeSigned, false);
  });

  it('篡改负测：翻形态值 / 翻观感 / 加依赖 / 放行 OCCT 建几何 / 改 deferred 为 active 一律 fail-closed', () => {
    const fresh = collectRulingCodification(ROOT);
    const override = (id, value) => Object.fromEntries(
      READING_IDS.map((rid) => [rid, rid === id ? { ...ownGet(fresh, rid), value } : { ...ownGet(fresh, rid) }]),
    );
    // 翻 D1 形态值（派生缓存 → 第二真值）必须红。
    const tamperedForm = { ...ownGet(fresh, 'rulings').value };
    tamperedForm.rulings = { ...tamperedForm.rulings, D1: { ...ownGet(tamperedForm.rulings, 'D1'), form: 'second_source_of_truth', status: 'ruled' } };
    assert.equal(validateRulingCodificationIntegrity(override('rulings', tamperedForm)).ok, false, '翻 D1 形态值必须 fail-closed');
    // 翻观感（代签 verified）必须红。
    const tamperedEye = { ...ownGet(fresh, 'boundaries').value, humanEyeZeroSign: false };
    assert.equal(validateRulingCodificationIntegrity(override('boundaries', tamperedEye)).ok, false, '观感代签必须 fail-closed');
    // 放行 OCCT 建几何必须红。
    const tamperedOcct = { ...ownGet(fresh, 'featureIdentity').value, noOcctBuildGeometry: false };
    assert.equal(validateRulingCodificationIntegrity(override('featureIdentity', tamperedOcct)).ok, false, '放行 OCCT 建几何必须 fail-closed');
    // 把 deferred 改成 active 必须红。
    const t = ownGet(fresh, 'implementationTickets').value;
    const tamperedTickets = { ...t, tickets: { ...t.tickets, 'P3-03-v2a': { ...ownGet(t.tickets, 'P3-03-v2a'), status: 'active' } } };
    assert.equal(validateRulingCodificationIntegrity(override('implementationTickets', tamperedTickets)).ok, false, 'deferred 改 active 必须 fail-closed');
    // 直接注入篡改真源：RULING-04 材料删掉禁 OCCT 建几何句 → noOcctBuildGeometry 翻红。
    const rulingTampered = scanRulings(ROOT, {
      'docs/block-322-ruling-04-feature-reference-v2.md': 'feature reference material with no red lines at all',
    });
    assert.equal(rulingTampered.rulings.D1.status, 'pending_user_ruling', '篡改材料后不得仍报 ruled');
    // 直接注入篡改边界：package.json 加新依赖 → noNewDependency 翻红。
    const depTampered = scanBoundaries(ROOT, {
      'package.json': '{"dependencies":{"some-new-heavy-dep":"^9.9.9"}}',
    });
    assert.equal(depTampered.noNewDependency, false, '新增依赖的篡改源必须被检测');
  });

  it('零回归基线：RULING-04 材料 / BLOCK-322 主纲 / 观感台账真源文件在场', () => {
    for (const f of [
      'docs/block-322-ruling-04-feature-reference-v2.md',
      'docs/block-322-model3d-full-spectrum-plan.md',
      'docs/ui-productization-audit.md',
      'docs/AGENTS.md',
    ].filter((p) => p !== 'docs/AGENTS.md').concat(['AGENTS.md'])) {
      assert.equal(fs.existsSync(path.join(ROOT, f)), true, `${f} 零回归基线不得被破坏`);
    }
    const ledger = fs.readFileSync(path.join(ROOT, 'docs/ui-productization-audit.md'), 'utf8');
    assert.ok(/UI-706/.test(ledger) && /pending_human_eye/.test(ledger), '观感台账锚点仍在场');
  });
});
