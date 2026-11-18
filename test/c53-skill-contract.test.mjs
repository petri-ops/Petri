import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import {
  collectSkillContract,
  validateSkillContractIntegrity,
  scanDesignContextConsumption,
  scanIaConsumption,
  scanA11yConstraints,
  scanSkillVersionContract,
  scanBridgeAlignment,
  READING_IDS,
  SKILL_FLOOR,
} from '../scripts/c53-skill-contract.mjs';

// BLOCK-475 / C-53 S5 P6 — HK-01 红绿先行 + 篡改负测。
// 产品 Skill v1.1 契约必须从真源机械派生并被本测试锚定：
// ① 快照六组读数结构完整 ② 逐读数现读一致（可复算）③ design-context 消费
// ④ IA 消费 ⑤ a11y 约束 ⑥ Skill 版本契约 ⑦ 发现桥对齐 ⑧ 观感留槽零代签
// ⑨ manifest sha256 ⑩ 篡改负测 fail-closed ⑪ P0–P5 零回归。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = path.join(ROOT, 'acceptance/block475-c53-p6-skill-contract/skill-contract-snapshot.json');
const CONTRACT = path.join(ROOT, 'resources/design-context/skill-contract.json');
const MANIFEST = path.join(ROOT, 'resources/design-context/manifest.json');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const ownGet = (obj, key) => Object.entries(obj ?? {}).find(([k]) => k === key)?.[1];

describe('C-53 P6 产品 Skill v1.1 契约可复算（HK-01）', () => {
  it('快照与契约在场且结构完整（六组读数带 value/source/command/capturedAt）', () => {
    assert.equal(fs.existsSync(SNAPSHOT), true, 'skill-contract-snapshot.json 必须在场');
    assert.equal(fs.existsSync(CONTRACT), true, 'skill-contract.json 必须在场');
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    assert.equal(snap.kind, 'c53-skill-contract');
    assert.deepEqual(Object.keys(snap.readings).sort(), [...READING_IDS].sort());
    const check = validateSkillContractIntegrity(snap.readings);
    assert.equal(check.ok, true, `完整性: ${check.issues.join('; ')}`);
  });

  it('逐读数现读一致（collectSkillContract 重算与落盘 value 深等）', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const fresh = collectSkillContract(ROOT);
    for (const id of READING_IDS) {
      assert.deepEqual(
        ownGet(fresh, id).value,
        ownGet(snap.readings, id).value,
        `读数 ${id} 与现真源漂移（快照过期或真源变更未重算）`,
      );
    }
  });

  it('design-context 消费：五件套 JSON + manifest + 目录路径引用在场', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const c = ownGet(snap.readings, 'designContextConsumption').value;
    for (const f of SKILL_FLOOR.contextFiles) {
      assert.equal(ownGet(c.fileRefs, f), true, `design-brief 必须引用 ${f}`);
    }
    assert.equal(c.manifestRef, true, '必须引用 resources/design-context/manifest.json');
    assert.equal(c.dirRef, true, '必须引用 resources/design-context/ 真源目录');
  });

  it('IA 消费：ia-map / 路由 / 高频路径 / 重定向契约关键词在场', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const c = ownGet(snap.readings, 'iaConsumption').value;
    for (const k of Object.keys(SKILL_FLOOR.iaKeywords)) {
      assert.equal(ownGet(c.keywords, k), true, `IA 消费关键词 ${k} 必须在场`);
    }
    assert.equal(c.iaMapRef, true, '必须引用 ia-map.json');
  });

  it('a11y 约束：键盘/焦点/ARIA/对比度/触摸目标/断点 + responsive-a11y.json 在场', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const c = ownGet(snap.readings, 'a11yConstraints').value;
    for (const k of Object.keys(SKILL_FLOOR.a11yKeywords)) {
      assert.equal(ownGet(c.keywords, k), true, `a11y 约束关键词 ${k} 必须在场`);
    }
    assert.equal(c.a11yContractRef, true, '必须引用 responsive-a11y.json');
  });

  it('Skill 版本契约：1.1.0 两处一致 + 三类 capabilities 增补在场', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const c = ownGet(snap.readings, 'skillVersionContract').value;
    assert.equal(c.skillJsonVersion, '1.1.0', 'skill.json 必须升 1.1.0');
    assert.equal(c.manifestVersion, '1.1.0', 'manifest 登记必须同步 1.1.0');
    assert.equal(c.versionAligned, true, '两处版本必须一致');
    for (const cap of SKILL_FLOOR.capabilities) {
      assert.equal(ownGet(c.capabilities, cap), true, `capability ${cap} 必须在场`);
    }
    assert.equal(c.integrityCurrent, true, 'builtinSha256 必须已重算对齐');
  });

  it('发现桥对齐：petri-ui-design SKILL.md 真源纳入 + .codebuddy symlink 真链', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const c = ownGet(snap.readings, 'bridgeAlignment').value;
    assert.equal(c.agentSkillGoverningSources, true, 'Agent skill Governing sources 必须纳入 design-context 真源');
    assert.equal(c.agentSkillIaRef, true, 'Agent skill 必须引用 ia-map');
    assert.equal(c.agentSkillA11yRef, true, 'Agent skill 必须引用 a11y 契约');
    assert.equal(c.codebuddyBridgeReal, true, '.codebuddy 发现桥必须是真 symlink');
    assert.equal(c.bridgeTargetCorrect, true, '发现桥必须指向 .agents/skills/petri-ui-design');
  });

  it('观感留槽：pending_human_eye 保持 in_progress，零代签', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const h = ownGet(snap.readings, 'humanEyeSlots').value;
    assert.equal(h.humanEyeSigned, false, 'Agent 永不代签观感');
    assert.equal(h.status, 'in_progress', '观感项必须保持 in_progress');
    assert.ok(h.slots.length >= SKILL_FLOOR.humanEyeSlots, '观感槽清单不得空');
    assert.equal(h.readOnly, true);
  });

  it('manifest sha256 与 skill-contract.json 实际字节一致', () => {
    const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const entry = (m.files || []).find((f) => ownGet(f, 'path') === 'skill-contract.json');
    assert.ok(entry, 'manifest 必须登记 skill-contract.json');
    assert.equal(ownGet(entry, 'sha256'), sha256(fs.readFileSync(CONTRACT)), 'sha256 一致');
  });

  it('篡改负测 fail-closed：引用清零 / 版本漂移 / 结构破坏都被判红', () => {
    // design-context 消费注入空源 → 全部引用 false
    const emptyCtx = scanDesignContextConsumption(ROOT, {
      'resources/skills/design-brief/README.md': '# empty',
      'resources/skills/design-brief/prompts/system.md': '# empty',
    });
    for (const f of SKILL_FLOOR.contextFiles) {
      assert.equal(ownGet(emptyCtx.fileRefs, f), false, `空源必丢失 ${f} 引用`);
    }
    assert.equal(emptyCtx.dirRef, false, '空源必丢失目录引用');

    // IA / a11y 注入空源 → 关键词全 false
    const emptyIa = scanIaConsumption(ROOT, { 'resources/skills/design-brief/README.md': '# empty', 'resources/skills/design-brief/prompts/system.md': '# empty' });
    for (const k of Object.keys(SKILL_FLOOR.iaKeywords)) assert.equal(ownGet(emptyIa.keywords, k), false, `空源必丢失 IA 关键词 ${k}`);
    const emptyA11y = scanA11yConstraints(ROOT, { 'resources/skills/design-brief/README.md': '# empty', 'resources/skills/design-brief/prompts/system.md': '# empty' });
    for (const k of Object.keys(SKILL_FLOOR.a11yKeywords)) assert.equal(ownGet(emptyA11y.keywords, k), false, `空源必丢失 a11y 关键词 ${k}`);

    // 版本漂移 → versionAligned false
    const drifted = scanSkillVersionContract(ROOT, {
      'resources/skills/design-brief/skill.json': '{"version":"1.0.0","capabilities":[]}',
    });
    assert.equal(drifted.versionAligned, false, '版本漂移必红');

    // Agent skill 注入空源 → governing sources 全 false
    const emptyBridge = scanBridgeAlignment(ROOT, {
      '.agents/skills/petri-ui-design/SKILL.md': '# empty',
    });
    assert.equal(emptyBridge.agentSkillGoverningSources, false, '空源必丢失 Agent skill 真源引用');

    // 结构完整性：抽掉一组读数 → 红
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const broken = structuredClone(snap.readings);
    delete broken.bridgeAlignment;
    assert.equal(validateSkillContractIntegrity(broken).ok, false, '缺读数必红');

    // 契约读数漂移 → 与落盘深等失败
    const forged = structuredClone(snap.readings);
    ownGet(forged, 'skillVersionContract').value.versionAligned = false;
    assert.notDeepEqual(ownGet(forged, 'skillVersionContract').value, ownGet(collectSkillContract(ROOT), 'skillVersionContract').value);
  });

  it('P0–P5 + skills:check/integrity 零回归：既有契约产物全在场', () => {
    const dir = path.join(ROOT, 'resources/design-context');
    for (const f of ['design-context.json', 'ia-map.json', 'visual-consistency.json', 'responsive-a11y.json', 'performance-trust.json', 'skill-contract.json']) {
      assert.equal(fs.existsSync(path.join(dir, f)), true, `${f} 不得被破坏`);
    }
    for (const f of [
      'test/c53-design-context-pack.test.mjs',
      'test/c53-ia-map.test.mjs',
      'test/c53-visual-consistency.test.mjs',
      'test/c53-responsive-a11y.test.mjs',
      'test/c53-performance-trust.test.mjs',
      'scripts/post-s7-skill-integrity.mjs',
      'scripts/skill-scaffold.mjs',
    ]) {
      assert.equal(fs.existsSync(path.join(ROOT, f)), true, `${f} 零回归基线不得被破坏`);
    }
    const link = fs.lstatSync(path.join(ROOT, '.codebuddy/skills/petri-ui-design'));
    assert.equal(link.isSymbolicLink(), true, '.codebuddy 发现桥不得退化为普通文件');
  });
});
