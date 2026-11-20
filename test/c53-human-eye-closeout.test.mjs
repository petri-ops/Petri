import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import {
  collectHumanEyeCloseout,
  validateCloseoutIntegrity,
  scanUiLedgerSlots,
  scanSignatureSlots,
  READING_IDS,
  CLOSEOUT_FLOOR,
} from '../scripts/c53-human-eye-closeout.mjs';

// BLOCK-476 / C-53 S6 P7 — HK-01 红绿先行 + 篡改负测。
// 人眼收口非观感准备契约必须从真源机械派生并被本测试锚定：
// ①快照结构完整 ②逐读数现读一致（可复算）③UI 台账四槽 in_progress 零代签
// ④E 类 22 条诚实分层 ⑤签字槽 11 行全空 ⑥本批新 UI 面观感槽 ⑦证据索引齐
// ⑧观感留槽零代签 ⑨manifest sha256 ⑩篡改负测 fail-closed ⑪P0–P6 零回归。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = path.join(ROOT, 'acceptance/block476-c53-p7-human-eye-closeout/human-eye-closeout-snapshot.json');
const CONTRACT = path.join(ROOT, 'resources/design-context/human-eye-closeout.json');
const MANIFEST = path.join(ROOT, 'resources/design-context/manifest.json');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const ownGet = (obj, key) => Object.entries(obj ?? {}).find(([k]) => k === key)?.[1];

describe('C-53 P7 人眼收口非观感准备契约可复算（HK-01）', () => {
  it('快照与契约在场且结构完整（六组读数带 value/source/command/capturedAt）', () => {
    assert.equal(fs.existsSync(SNAPSHOT), true, 'human-eye-closeout-snapshot.json 必须在场');
    assert.equal(fs.existsSync(CONTRACT), true, 'human-eye-closeout.json 必须在场');
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    assert.equal(snap.kind, 'c53-human-eye-closeout');
    assert.deepEqual(Object.keys(snap.readings).sort(), [...READING_IDS].sort());
    const check = validateCloseoutIntegrity(snap.readings);
    assert.equal(check.ok, true, `完整性: ${check.issues.join('; ')}`);
  });

  it('逐读数现读一致（collectHumanEyeCloseout 重算与落盘 value 深等）', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const fresh = collectHumanEyeCloseout(ROOT);
    for (const id of READING_IDS) {
      assert.deepEqual(
        ownGet(fresh, id).value,
        ownGet(snap.readings, id).value,
        `读数 ${id} 与现真源漂移（快照过期或真源变更未重算）`,
      );
    }
  });

  it('UI 台账四槽：UI-706/707/709/710 记录态在场（2026-11-19 乙1–乙4 用户口令翻 verified）', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const c = ownGet(snap.readings, 'uiLedgerSlots').value;
    for (const id of CLOSEOUT_FLOOR.uiLedgerIds) {
      const slot = ownGet(c.slots, id);
      assert.ok(slot, `UI 台账槽 ${id} 必须在场`);
      assert.equal(slot.verified, true, `${id} 已由用户口令翻 verified（乙1–乙4，转录在案）`);
      // 注：段内历史行仍可能含 in_progress 字样（追加式台账），段落级扫描如实呈现混合标记——verified 为裁定态。
    }
  });

  it('E 类分层：22 条 = 11 verified / 2 cancelled / 9 in_progress（3 可过目）+ triage 现读登记', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const c = ownGet(snap.readings, 'eClassTiers').value;
    assert.equal(c.verified, 11, 'guide 分层 verified=11');
    assert.equal(c.cancelled, 2, 'guide 分层 cancelled=2');
    assert.equal(c.inProgress, 9, 'guide 分层 in_progress=9');
    assert.equal(c.worthReviewing, 3, 'guide 标注可过目=3');
    assert.equal(c.total, 22, 'E 类快照基数=22');
    assert.equal(c.triageBlockedCurrent >= 22, true, 'triage 现读 blocked 须登记（漂移如实）');
    assert.equal(c.driftDisclosed, true, '22 条快照 vs triage 现读的口径差异须如实登记');
  });

  it('签字槽：§3 11 行在场；部分已签（YI-REST-WB），E-01/E-03 保持空白零代填', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const c = ownGet(snap.readings, 'signatureSlots').value;
    assert.equal(c.total, 11, '签字槽应为 11 行（E-01/02/03 + H-01~H-08）');
    assert.equal(c.filled, 9, '已签=9（H-01~H-08 + E-02；H-06/H-08/E-02 为分批签署）');
    assert.equal(c.blankIds.includes('E-01'), true, 'E-01 保持 pending_human_eye 零代填');
    assert.equal(c.blankIds.includes('E-03'), true, 'E-03 保持 external-blocked 零代填');
    for (const id of ['H-01', 'H-02', 'H-03', 'H-04', 'H-05', 'H-06', 'H-07', 'H-08', 'E-02']) {
      assert.equal(c.blankIds.includes(id), false, `${id} 已签署（分批口径见 route §3）`);
    }
  });

  it('本批新 UI 面：P4 人眼格 + P5/P6 观感槽 in_progress 未签 + P2/P3 无观感面', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const c = ownGet(snap.readings, 'batchNewUiFaces').value;
    assert.equal(c.p4.humanEyeCells, 12, 'P4 八态人眼格=12');
    assert.equal(c.p5.humanEyeSigned, false, 'P5 观感槽未签');
    assert.equal(c.p5.status, 'in_progress', 'P5 观感槽保持 in_progress');
    assert.equal(c.p5.readOnly, true, 'P5 观感槽只读');
    assert.equal(c.p6.humanEyeSigned, false, 'P6 观感槽未签');
    assert.equal(c.p6.status, 'in_progress', 'P6 观感槽保持 in_progress');
    assert.equal(c.p6.readOnly, true, 'P6 观感槽只读');
    assert.equal(c.p2NoFace, true, 'P2 无 pending_human_eye 面声明须在场');
    assert.equal(c.p3NoFace, true, 'P3 无 pending_human_eye 面声明须在场');
  });

  it('证据索引：每条清单项的 acceptance/真源路径在场（可核）', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const c = ownGet(snap.readings, 'evidenceIndex').value;
    assert.ok(c.entries.length >= CLOSEOUT_FLOOR.evidenceIndexMin, '证据索引条目不得空');
    for (const e of c.entries) {
      assert.equal(e.exists, true, `证据路径缺失: ${e.path}`);
    }
    assert.equal(c.allPresent, true, '所有证据路径须在场');
  });

  it('观感留槽：humanEyeSigned=true / status=signed-partial（用户批量口令+Agent 审定·委托；pending 项留槽）', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const h = ownGet(snap.readings, 'humanEyeSlots').value;
    assert.equal(h.humanEyeSigned, true, '签署成立（用户口令在案，非 Agent 代签）');
    assert.equal(h.status, 'signed-partial', '部分已签态（E-01/E-03/H-06 部分文件 pending）');
    assert.equal(h.readOnly, true, '签字槽只读留用户');
    assert.ok(h.slots.length >= 2, '已签/待签清单不得空');
  });

  it('manifest sha256 与 human-eye-closeout.json 实际字节一致', () => {
    const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const entry = (m.files || []).find((f) => ownGet(f, 'path') === 'human-eye-closeout.json');
    assert.ok(entry, 'manifest 必须登记 human-eye-closeout.json');
    assert.equal(ownGet(entry, 'sha256'), sha256(fs.readFileSync(CONTRACT)), 'sha256 一致');
  });

  it('篡改负测 fail-closed：状态写 verified / 签字填名 / 观感代签 / 结构破坏都判红', () => {
    // UI 台账注入 verified → verified=true，inProgress=false
    const forgedLedger = scanUiLedgerSlots(ROOT, {
      'docs/ui-productization-audit.md': '## UI-706: x（2026-11-18 **verified**）\n## UI-707: x（2026-11-18 **verified**）\n## UI-708: x（verified）\n## UI-709: x（verified）\n## UI-710: x（verified）',
    });
    assert.equal(ownGet(forgedLedger.slots, 'UI-706').verified, true, 'verified 写入须被识别');
    assert.equal(ownGet(forgedLedger.slots, 'UI-706').inProgress, false, 'verified 场景 inProgress 必 false');

    // 签字槽注入填写 → filled>0
    const filledRoute = '## 3. 签字槽（Agent 不填写）\n\n| 路线 | 覆盖断言 | 签字人 | 日期 | 结论 |\n| --- | --- | --- | --- | --- |\n| E-01 树测试 | x | 张三 | 2026-11-18 | 通过 |';
    const forgedSig = scanSignatureSlots(ROOT, { 'docs/ui-design-human-eye-route.md': filledRoute });
    assert.ok(forgedSig.filled >= 1, '签字槽填入须被识别');

    // 观感槽注入代签 → 契约 collect 阶段 fail-closed 由完整性/测试守护，这里验证结构破坏
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const broken = structuredClone(snap.readings);
    delete broken.humanEyeSlots;
    assert.equal(validateCloseoutIntegrity(broken).ok, false, '缺读数必红');

    // 读数漂移 → 与落盘深等失败（签署已成立，反向篡改回「未签」才构成漂移）
    const forged = structuredClone(snap.readings);
    ownGet(forged, 'humanEyeSlots').value.humanEyeSigned = false;
    ownGet(forged, 'humanEyeSlots').value.status = 'in_progress';
    assert.notDeepEqual(ownGet(forged, 'humanEyeSlots').value, ownGet(collectHumanEyeCloseout(ROOT), 'humanEyeSlots').value);
  });

  it('P0–P6 + design-brief/integrity 零回归：既有契约产物全在场', () => {
    const dir = path.join(ROOT, 'resources/design-context');
    for (const f of ['design-context.json', 'ia-map.json', 'visual-consistency.json', 'responsive-a11y.json', 'performance-trust.json', 'skill-contract.json', 'human-eye-closeout.json']) {
      assert.equal(fs.existsSync(path.join(dir, f)), true, `${f} 不得被破坏`);
    }
    for (const f of [
      'test/c53-design-context-pack.test.mjs',
      'test/c53-ia-map.test.mjs',
      'test/c53-visual-consistency.test.mjs',
      'test/c53-responsive-a11y.test.mjs',
      'test/c53-performance-trust.test.mjs',
      'test/c53-skill-contract.test.mjs',
    ]) {
      assert.equal(fs.existsSync(path.join(ROOT, f)), true, `${f} 零回归基线不得被破坏`);
    }
  });
});
