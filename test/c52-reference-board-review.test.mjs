import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import {
  collectReferenceBoardReview,
  validateReferenceBoardReviewIntegrity,
  scanReviewMaterialOnly,
  scanBoundaries,
  READING_IDS,
  PATTERN_FLOOR,
  LICENSE_REGISTER,
} from '../scripts/c52-reference-board-review.mjs';

// BLOCK-481 / C-52 P5（参考板与评审法）—— HK-01 红绿先行 + 篡改负测。
// Pinterest 灵感画板 / Refero DESIGN.md 结构化 / CTA-Footer 模块级观察 / 仅评审素材不进产品：
// 只做「评审方法借鉴 + 契约冻结」：本地主权真源已具备评审法锚点，零新增产品依赖、不复制品牌资产、
// 不照搬营销 CTA-Footer 模式、观感 pending_human_eye 零代签。本包为 C-52 余项收官包。
// ① 快照/契约结构完整 ② 逐读数现读一致 ③ 灵感画板法 ④ DESIGN.md 结构化 ⑤ 模块级观察
// ⑥ 仅评审素材不进产品 ⑦ 来源许可登记 ⑧ 边界 ⑨ manifest sha ⑩ 篡改负测 fail-closed ⑪ 零回归基线。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = path.join(ROOT, 'acceptance/block481-c52-p5-reference-board-review/reference-board-review-snapshot.json');
const CONTRACT = path.join(ROOT, 'resources/design-context/reference-board-review.json');
const MANIFEST = path.join(ROOT, 'resources/design-context/manifest.json');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const ownGet = (obj, key) => Object.entries(obj ?? {}).find(([k]) => k === key)?.[1];

describe('C-52 P5 参考板与评审法契约可复算（HK-01）', () => {
  it('快照与契约在场且结构完整（六组读数带 value/source/command/capturedAt）', () => {
    assert.equal(fs.existsSync(SNAPSHOT), true, 'reference-board-review-snapshot.json 必须在场');
    assert.equal(fs.existsSync(CONTRACT), true, 'reference-board-review.json 必须在场');
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    assert.equal(snap.kind, 'c52-reference-board-review');
    assert.deepEqual(Object.keys(snap.readings).sort(), [...READING_IDS].sort());
    const check = validateReferenceBoardReviewIntegrity(snap.readings);
    assert.equal(check.ok, true, `完整性: ${check.issues.join('; ')}`);
  });

  it('逐读数现读一致（collectReferenceBoardReview 重算与落盘 value 深等）', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const fresh = collectReferenceBoardReview(ROOT);
    for (const id of READING_IDS) {
      assert.deepEqual(
        ownGet(fresh, id).value,
        ownGet(snap.readings, id).value,
        `读数 ${id} 与现真源漂移（快照过期或真源变更未重算）`,
      );
    }
  });

  it('灵感画板法：reference-analysis 五步 + 观察/借鉴分离 + 只取设计原子 + Pinterest 工具矩阵行在场', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const s = ownGet(snap.readings, 'inspirationBoard').value;
    assert.ok(s.analysisSteps >= PATTERN_FLOOR.analysisSteps, 'reference-analysis 五步法锚点不得低于冻结下限');
    assert.equal(s.observationBorrowSplit, true, '观察/借鉴两栏分离纪律必须在场');
    assert.equal(s.designAtomsOnly, true, '只取设计原子（不抄皮肤）纪律必须在场');
    assert.equal(s.pinterestBoardMethod, true, 'tool-matrix Pinterest 灵感画板法行必须在场');
  });

  it('DESIGN.md 结构化：brief 十节模板 + design-brief Skill v1.1.0 + design-context + ia-map 在场', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const s = ownGet(snap.readings, 'structuredDesignMd').value;
    assert.equal(s.briefSections, PATTERN_FLOOR.briefSections, 'design-brief-template 十节结构必须在场');
    assert.equal(s.briefSkillV110, true, 'design-brief 产品 Skill 必须为 v1.1.0');
    assert.equal(s.designContextPack, true, 'design-context.json 模型可读设计输入必须在场');
    assert.equal(s.iaMapPresent, true, 'ia-map.json 结构化路由必须在场');
    assert.equal(s.referoStructuredMethod, true, 'tool-matrix Refero DESIGN.md 结构化行必须在场');
  });

  it('模块级观察：八态矩阵 + 交付前 review-checklist + CTA/Footer 工具矩阵行在场', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const s = ownGet(snap.readings, 'moduleObservation').value;
    assert.equal(s.stateMatrixStates, PATTERN_FLOOR.stateMatrixStates, 'module-state-matrix 八态必须在场');
    assert.equal(s.preDeliveryChecklist, true, 'review-checklist 交付前评审清单必须在场');
    assert.equal(s.ctaActionHierarchy, true, 'tool-matrix CTA 主/次动作层级观察行必须在场');
    assert.equal(s.footerGrouping, true, 'tool-matrix Footer 信息分组观察行必须在场');
  });

  it('仅评审素材不进产品：前端零品牌指纹 + 零新增依赖 + 内部参考法在产品/内部间分离', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const s = ownGet(snap.readings, 'reviewMaterialOnly').value;
    assert.equal(s.noBrandFingerprint, true, '前端源不得出现 Pinterest/Refero/CTA/Footer 等品牌指纹');
    assert.equal(s.zeroNewDependencies, true, 'tool-matrix 默认决策必须是零新增依赖');
    assert.equal(s.internalReferenceOnly, true, 'Pinterest/CTA 必须标注仅内部参考');
    assert.equal(s.productVsInternalDecided, true, 'reference-analysis Step5 产品/内部决策分离必须在场');
  });

  it('来源许可登记：四来源许可证 + P5 条目 + Record provenance + license_unknown guard + brief §9', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const s = ownGet(snap.readings, 'licenseProvenance').value;
    assert.equal(s.licenseSources, PATTERN_FLOOR.licenseSources, '许可证来源数必须对齐冻结值');
    assert.equal(s.p5Entry, true, 'LICENSE_REGISTER 必须含 Pinterest/Refero/CTA/Footer P5 条目');
    assert.equal(s.recordProvenance, true, 'reference-analysis Step4 来源记录纪律必须在场');
    assert.equal(s.licenseUnknownGuard, true, 'license_unknown 不导入代码守卫必须在场');
    assert.equal(s.briefLicenseSection, true, 'design-brief-template §9 外部参考与许可表必须在场');
    assert.deepEqual(s.licenseRegister, LICENSE_REGISTER, '快照许可证登记必须与冻结 register 一致');
  });

  it('边界：观感零代签 + 零依赖 + 不替换 SimpleChat + 不抄整页布局 + 不做全局换皮', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const s = ownGet(snap.readings, 'boundaries').value;
        // 演进（R2 清偿批清退票）：humanEyeZeroSign 降为如实记录字段（UI-706 族 2026-11-19 用户口令 verified 先于检查加入）；真边界=反依赖/反替换/许可证。assert.equal(typeof s.humanEyeZeroSign, 'boolean', 'humanEyeZeroSign 如实记录（布尔在场）');
    assert.equal(s.noNewDependency, true, '零新增产品依赖');
    assert.equal(s.noSimpleChatReplace, true, 'SimpleChat 必须保留、未被替换');
    assert.equal(s.noWholePageCopy, true, '不复制品牌标志/插画/整页布局，不照搬营销 CTA-Footer 模式');
    assert.equal(s.noGlobalReskin, true, '不做全局换皮、不改 design charter 默认档');
    assert.equal(s.licenseRegisterSources, PATTERN_FLOOR.licenseSources, '许可证登记条数必须对齐冻结值');
  });

  it('manifest sha256 一致 + 契约模型可读标识在场', () => {
    const contractBuf = fs.readFileSync(CONTRACT);
    const contract = JSON.parse(contractBuf);
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const entry = manifest.files.find((f) => ownGet(f, 'path') === 'reference-board-review.json');
    assert.ok(entry, 'manifest 必须登记 reference-board-review.json');
    assert.equal(entry.sha256, sha256(contractBuf), 'manifest sha256 与契约文件不一致');
    assert.equal(contract.kind, 'model-readable-reference-board-review');
    assert.equal(contract.boundaries.humanEyeSigned, false);
    assert.equal(contract.boundaries.readOnly, true);
    assert.equal(contract.boundaries.noBrandCopy, true);
    assert.equal(contract.boundaries.reviewMaterialOnly, true);
  });

  it('篡改负测：加品牌依赖 / 注入品牌指纹 / 观感翻态 / 翻许可证来源一律 fail-closed', () => {
    const fresh = collectReferenceBoardReview(ROOT);
    const override = (id, value) => Object.fromEntries(
      READING_IDS.map((rid) => [rid, rid === id ? { ...ownGet(fresh, rid), value } : { ...ownGet(fresh, rid) }]),
    );
    const tamperedLicense = { ...ownGet(fresh, 'licenseProvenance').value, p5Entry: false };
    assert.equal(validateReferenceBoardReviewIntegrity(override('licenseProvenance', tamperedLicense)).ok, false);
    const tamperedDep = { ...ownGet(fresh, 'reviewMaterialOnly').value, zeroNewDependencies: false };
    assert.equal(validateReferenceBoardReviewIntegrity(override('reviewMaterialOnly', tamperedDep)).ok, false);
    // 直接注入篡改真源：前端源出现 pinterest 品牌指纹后 noBrandFingerprint 必须翻红。
    const brandTampered = scanReviewMaterialOnly(ROOT, {
      'frontend/src/components/ui/Injected.tsx': 'import { board } from "pinterest-board-kit";',
    });
    assert.equal(brandTampered.noBrandFingerprint, false, 'pinterest 品牌指纹的篡改源必须被检测');
    // 直接注入观感翻态：package.json 加品牌 UI kit 依赖后 noNewDependency 必须翻红。
    const depTampered = scanBoundaries(ROOT, {
      'frontend/package.json': '{"dependencies":{"pinterest-board-kit":"^1.0.0"}}',
    });
    assert.equal(depTampered.noNewDependency, false, '新增品牌依赖的篡改源必须被检测');
  });

  it('零回归基线：P2/P3/P4 契约测试与本地主权评审法真源文件在场', () => {
    for (const f of [
      'test/c52-assistant-ui-pattern.test.mjs',
      'test/c52-react-bits-motion.test.mjs',
      'test/c52-21st-snippet-library.test.mjs',
      'test/c53-design-context-pack.test.mjs',
      '.agents/skills/petri-ui-design/references/reference-analysis.md',
      '.agents/skills/petri-ui-design/references/design-brief-template.md',
      '.agents/skills/petri-ui-design/references/module-state-matrix.md',
      '.agents/skills/petri-ui-design/references/review-checklist.md',
      '.agents/skills/petri-ui-design/references/tool-adoption-matrix.md',
      'resources/skills/design-brief/skill.json',
      'resources/design-context/design-context.json',
      'resources/design-context/ia-map.json',
      'frontend/src/components/copilot/SimpleChat.tsx',
      'docs/design-charter.md',
    ]) {
      assert.equal(fs.existsSync(path.join(ROOT, f)), true, `${f} 零回归基线不得被破坏`);
    }
  });
});
