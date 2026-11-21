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
  scanImplementationTickets,
  RULING_IDS,
  RULING_FORM,
  DEFERRED_TICKETS,
  READING_IDS,
} from '../scripts/block491-ruling-codification.mjs';

/** 篡改注入：把 BLOCK-496 对齐表整体换成无关文本（状态必须回退 undetermined，不得沿用旧值）。 */
function scanImplementationTicketsSourcesOverridden(root) {
  return scanImplementationTickets(root, {
    'docs/block496-ruling-registration-realign-plan.md': 'alignment plan with no machine readable status table at all',
  });
}

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

  it('实现票生命周期对齐（BLOCK-496）：三票 implemented / v2c 维持；证据在盘', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const s = ownGet(snap.readings, 'implementationTickets').value;
    assert.deepEqual(Object.keys(s.tickets).sort(), [...DEFERRED_TICKETS].sort());
    const expected = {
      'P4-05b': 'implemented',
      'P3-03-v2a': 'implemented',
      'P3-03-v2b': 'implemented',
      'P3-03-v2c': 'deferred_maintained',
    };
    for (const id of DEFERRED_TICKETS) {
      const row = ownGet(s.tickets, id);
      // eslint-disable-next-line security/detect-object-injection -- id 来自 DEFERRED_TICKETS 冻结白名单，expected 为同源字面量表
      assert.equal(row.status, expected[id], `${id} 状态须与 2026-11-19 对齐表（BLOCK-496 §3）一致`);
      assert.equal(row.reopenRequiresUserOrder, true, `${id} 越过当前状态推进须用户新发令`);
    }
    assert.equal(ownGet(s.tickets, 'P4-05b').evidence, 'acceptance/block-322-ruling04/p405b-live-macos.json');
    assert.equal(ownGet(s.tickets, 'P3-03-v2a').evidence, 'acceptance/block-322-p3/p3-03-v2a-live-macos.json');
    assert.equal(ownGet(s.tickets, 'P3-03-v2b').evidence, 'acceptance/block504-v2b-import-features/');
    // 登记≠存在：已实现票的证据文件必须在盘（实况锚，BLOCK-494 教训）。
    for (const ev of ['acceptance/block-322-ruling04/p405b-live-macos.json', 'acceptance/block-322-p3/p3-03-v2a-live-macos.json', 'acceptance/block504-v2b-import-features/hk01-green.txt']) {
      assert.equal(fs.existsSync(path.join(ROOT, ev)), true, `已实现票证据必须在盘：${ev}`);
    }
    assert.equal(s.v2cSeparated, true, 'v2c 必须单列');
    assert.equal(s.alignmentAuthorized, true, '2026-11-19 对齐授权段（BLOCK-496 §2）必须在场');
    assert.equal(s.p4_05_full_chain.status, 'implemented', 'P4-05 完整尺寸链=已实现（BLOCK-499）');
    assert.equal(s.p4_05_full_chain.implementedAt, '2026-11-19');
    assert.equal(s.p4_05_full_chain.dependsOn, 'P3-03-v2b');
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
    // 演进（R2 清偿批清退票）：重冻结后 humanEyeZeroSign=false（UI-706 族 11-19 用户口令 verified），
    // 降为如实记录字段；真边界=零依赖/契约不变/零写面/不碰 G1+（见下断言）。
    assert.equal(typeof s.humanEyeZeroSign, 'boolean', 'humanEyeZeroSign 如实记录（布尔在场）');
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
    assert.equal(contract.boundaries.codificationIsNotImplementation, true, '契约工具自身零实现写面');
    assert.equal(contract.boundaries.humanEyeSigned, false);
  });

  it('篡改负测：翻形态值 / 翻观感 / 加依赖 / 放行 OCCT 建几何 / 越权改票状态 / 抹授权段 一律 fail-closed', () => {
    const fresh = collectRulingCodification(ROOT);
    const override = (id, value) => Object.fromEntries(
      READING_IDS.map((rid) => [rid, rid === id ? { ...ownGet(fresh, rid), value } : { ...ownGet(fresh, rid) }]),
    );
    // 翻 D1 形态值（派生缓存 → 第二真值）必须红。
    const tamperedForm = { ...ownGet(fresh, 'rulings').value };
    tamperedForm.rulings = { ...tamperedForm.rulings, D1: { ...ownGet(tamperedForm.rulings, 'D1'), form: 'second_source_of_truth', status: 'ruled' } };
    assert.equal(validateRulingCodificationIntegrity(override('rulings', tamperedForm)).ok, false, '翻 D1 形态值必须 fail-closed');
    // eye 篡改负测退役（humanEyeZeroSign 降为如实记录字段，门已不含；其余真边界篡改仍覆盖）。
    // 放行 OCCT 建几何必须红。
    const tamperedOcct = { ...ownGet(fresh, 'featureIdentity').value, noOcctBuildGeometry: false };
    assert.equal(validateRulingCodificationIntegrity(override('featureIdentity', tamperedOcct)).ok, false, '放行 OCCT 建几何必须 fail-closed');
    // 越权改票状态：非法枚举值（active）必须红。
    const t = ownGet(fresh, 'implementationTickets').value;
    const tamperedActive = { ...t, tickets: { ...t.tickets, 'P3-03-v2a': { ...ownGet(t.tickets, 'P3-03-v2a'), status: 'active' } } };
    assert.equal(validateRulingCodificationIntegrity(override('implementationTickets', tamperedActive)).ok, false, '非法票状态必须 fail-closed');
    // 越权推进：implemented 票证据指针被抹（无证据）必须红（v2a 为已实现票锚）。
    const tamperedSkip = { ...t, tickets: { ...t.tickets, 'P3-03-v2a': { ...ownGet(t.tickets, 'P3-03-v2a'), evidence: null } } };
    assert.equal(validateRulingCodificationIntegrity(override('implementationTickets', tamperedSkip)).ok, false, 'implemented 无证据必须 fail-closed');
    // 已实现票证据指针被抹必须红。
    const tamperedEvidence = { ...t, tickets: { ...t.tickets, 'P4-05b': { ...ownGet(t.tickets, 'P4-05b'), evidence: null } } };
    assert.equal(validateRulingCodificationIntegrity(override('implementationTickets', tamperedEvidence)).ok, false, 'implemented 票缺证据指针必须 fail-closed');
    // 对齐授权段被抹必须红。
    const tamperedAuth = { ...t, alignmentAuthorized: false };
    assert.equal(validateRulingCodificationIntegrity(override('implementationTickets', tamperedAuth)).ok, false, '对齐授权缺席必须 fail-closed');
    // 直接注入篡改对齐表：状态表整体被换 → 票状态回退 undetermined（不得沿用旧值）。
    const alignTampered = scanImplementationTicketsSourcesOverridden(ROOT);
    assert.equal(alignTampered.tickets['P3-03-v2a'].status, 'undetermined', '篡改对齐表后不得仍报 implemented');
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
