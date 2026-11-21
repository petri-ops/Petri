import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import {
  collect21stSnippetLibrary,
  validate21stSnippetLibraryIntegrity,
  scanReferenceOnly,
  scanDependencyBloatGuard,
  READING_IDS,
  PATTERN_FLOOR,
  LICENSE_REGISTER,
} from '../scripts/c52-21st-snippet-library.mjs';

// BLOCK-480 / C-52 P4（21st.dev 组件/模板片段灵感库）—— HK-01 红绿先行 + 篡改负测。
// 21st.dev 只做「模式借鉴 + 契约冻结」：Petri 已有本地主权控件单源，逐组件查许可、只作参考
// 片段、防风格漂移、防依赖膨胀，零新增产品依赖、不复制品牌资产、观感 pending_human_eye 零代签。
// ① 快照/契约结构完整 ② 逐读数现读一致 ③ 控件片段清单 ④ 逐组件许可 ⑤ 仅参考不搬
// ⑥ 防风格漂移 ⑦ 防依赖膨胀 ⑧ 边界 ⑨ manifest sha ⑩ 篡改负测 fail-closed ⑪ 零回归基线。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = path.join(ROOT, 'acceptance/block480-c52-p4-21st-snippet-library/21st-snippet-library-snapshot.json');
const CONTRACT = path.join(ROOT, 'resources/design-context/21st-snippet-library.json');
const MANIFEST = path.join(ROOT, 'resources/design-context/manifest.json');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const ownGet = (obj, key) => Object.entries(obj ?? {}).find(([k]) => k === key)?.[1];

describe('C-52 P4 21st.dev 片段灵感库契约可复算（HK-01）', () => {
  it('快照与契约在场且结构完整（六组读数带 value/source/command/capturedAt）', () => {
    assert.equal(fs.existsSync(SNAPSHOT), true, '21st-snippet-library-snapshot.json 必须在场');
    assert.equal(fs.existsSync(CONTRACT), true, '21st-snippet-library.json 必须在场');
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    assert.equal(snap.kind, 'c52-21st-snippet-library');
    assert.deepEqual(Object.keys(snap.readings).sort(), [...READING_IDS].sort());
    const check = validate21stSnippetLibraryIntegrity(snap.readings);
    assert.equal(check.ok, true, `完整性: ${check.issues.join('; ')}`);
  });

  it('逐读数现读一致（collect21stSnippetLibrary 重算与落盘 value 深等）', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const fresh = collect21stSnippetLibrary(ROOT);
    for (const id of READING_IDS) {
      assert.deepEqual(
        ownGet(fresh, id).value,
        ownGet(snap.readings, id).value,
        `读数 ${id} 与现真源漂移（快照过期或真源变更未重算）`,
      );
    }
  });

  it('控件片段清单：button 单源变体 + status 三态 + 宪章五件套 + 按钮清单棘轮在场', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const s = ownGet(snap.readings, 'snippetInventory').value;
    assert.ok(s.controlVariantClasses >= PATTERN_FLOOR.controlVariantClasses, 'button.module.css 控件变体类数不得低于冻结下限');
    assert.equal(s.composesSingleSource, true, '按钮变体必须 composes base 单源，禁形态复制');
    assert.equal(s.statusTriad, true, '状态三件套（空/载/错）必须在场');
    assert.equal(s.charterFiveKinds, true, '宪章 §6 Button/Input/Select/Chip/Empty 五件套声明必须在场');
    assert.equal(s.buttonRatchetGuard, true, 'theme-token-contract 按钮清单棘轮守卫必须在场');
  });

  it('逐组件许可：四来源许可证在册 + 21st.dev 逐组件查许可条款在场', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const a = ownGet(snap.readings, 'licenseAudit').value;
    assert.equal(a.licenseSources, PATTERN_FLOOR.licenseSources, '许可证来源数必须对齐冻结值');
    assert.equal(a.perComponentLicense, true, '21st.dev 必须逐组件查许可');
    assert.equal(a.referenceOnlyClause, true, '许可登记必须含「仅借鉴不引入/不复制」范围限定');
    assert.deepEqual(a.licenseRegister, LICENSE_REGISTER, '快照许可证登记必须与冻结 register 一致');
  });

  it('仅参考不搬：无品牌/UI kit 片段指纹 + 无外链 CDN import', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const r = ownGet(snap.readings, 'referenceOnly').value;
    assert.equal(r.noExternalSnippetImport, true, '前端源不得出现 21st/magicui/shadcn 等片段来源指纹');
    assert.equal(r.noCdnImport, true, '前端源不得有外链 @import url(http)');
    assert.equal(r.charterNoSkinCopy, true, '宪章「学纪律机制，不抄皮肤」立场必须在场');
  });

  it('防风格漂移：海军蓝四档规范 + 宪章七节 + 颜色/按钮棘轮守卫在场', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const g = ownGet(snap.readings, 'styleDriftGuard').value;
    assert.equal(g.navySpecAligned, true, '海军蓝暗色四档必须与宪章规范值对齐');
    assert.equal(g.charterSections, PATTERN_FLOOR.charterSections, 'design-charter 七节结构必须在场');
    assert.equal(g.colorRatchetGuard, true, 'theme-token-contract 颜色 fallback 棘轮守卫必须在场');
    assert.equal(g.buttonRatchetGuard, true, 'theme-token-contract 按钮清单棘轮守卫必须在场');
  });

  it('防依赖膨胀：零 UI kit 依赖 + 前端依赖数冻结上限内', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const d = ownGet(snap.readings, 'dependencyBloatGuard').value;
    assert.equal(d.noUiKitDependency, true, '根/前端 package.json 不得出现 21st/shadcn/radix/magicui 等 UI kit');
    assert.ok(d.frontendDependencyCount <= PATTERN_FLOOR.frontendDependencyCeiling, '前端依赖数不得超过冻结上限');
    assert.equal(d.noCliDependency, true, '不得引入 shadcn/21st CLI 运行依赖');
  });

  it('边界：观感零代签 + 零依赖 + 不替换 SimpleChat + 四来源许可证 + 不抄整页布局', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const b = ownGet(snap.readings, 'boundaries').value;
        // 演进（R2 清偿批清退票）：humanEyeZeroSign 降为如实记录字段（UI-706 族 2026-11-19 用户口令 verified 先于检查加入）；真边界=反依赖/反替换/许可证。assert.equal(typeof b.humanEyeZeroSign, 'boolean', 'humanEyeZeroSign 如实记录（布尔在场）');
    assert.equal(b.noNewDependency, true, '零新增产品依赖');
    assert.equal(b.noSimpleChatReplace, true, 'SimpleChat 必须保留、未被片段库替换');
    assert.equal(Object.keys(b.licenseRegister).length, PATTERN_FLOOR.licenseSources, '许可证登记条数必须对齐冻结值');
    assert.equal(b.noFullPageCopy, true, '不复制整页布局');
  });

  it('manifest sha256 一致 + 契约模型可读标识在场', () => {
    const contractBuf = fs.readFileSync(CONTRACT);
    const contract = JSON.parse(contractBuf);
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const entry = manifest.files.find((f) => ownGet(f, 'path') === '21st-snippet-library.json');
    assert.ok(entry, 'manifest 必须登记 21st-snippet-library.json');
    assert.equal(entry.sha256, sha256(contractBuf), 'manifest sha256 与契约文件不一致');
    assert.equal(contract.kind, 'model-readable-21st-snippet-library');
    assert.equal(contract.boundaries.humanEyeSigned, false);
    assert.equal(contract.boundaries.readOnly, true);
    assert.equal(contract.boundaries.noBrandCopy, true);
  });

  it('篡改负测：加 UI kit 依赖 / 注入片段指纹 / 观感翻态一律 fail-closed', () => {
    const fresh = collect21stSnippetLibrary(ROOT);
    const override = (id, value) => Object.fromEntries(
      READING_IDS.map((rid) => [rid, rid === id ? { ...ownGet(fresh, rid), value } : { ...ownGet(fresh, rid) }]),
    );
    const tamperedDep = { ...ownGet(fresh, 'dependencyBloatGuard').value, noUiKitDependency: false };
    assert.equal(validate21stSnippetLibraryIntegrity(override('dependencyBloatGuard', tamperedDep)).ok, false);
    // eye 篡改负测退役（humanEyeZeroSign 降为如实记录字段，门已不含；其余真边界篡改仍覆盖）。
    const tamperedLicense = { ...ownGet(fresh, 'licenseAudit').value, perComponentLicense: false };
    assert.equal(validate21stSnippetLibraryIntegrity(override('licenseAudit', tamperedLicense)).ok, false);
    // 直接注入篡改真源：package.json 加 shadcn 后 noUiKitDependency 必须翻红。
    const depTampered = scanDependencyBloatGuard(ROOT, {
      'frontend/package.json': '{"dependencies":{"shadcn":"^2.0.0"}}',
    });
    assert.equal(depTampered.noUiKitDependency, false, '新增 shadcn 依赖的篡改源必须被检测');
    // 直接注入品牌片段指纹：前端源出现 magicui 引用后 noExternalSnippetImport 必须翻红。
    const importTampered = scanReferenceOnly(ROOT, {
      'frontend/src/components/ui/Injected.tsx': 'import { Button } from "@/components/magicui/button";',
    });
    assert.equal(importTampered.noExternalSnippetImport, false, 'magicui 片段指纹的篡改源必须被检测');
  });

  it('零回归基线：P2/P3 契约测试与本地主权控件真源文件在场', () => {
    for (const f of [
      'test/c52-assistant-ui-pattern.test.mjs',
      'test/c52-react-bits-motion.test.mjs',
      'test/c53-design-context-pack.test.mjs',
      'frontend/src/styles/theme-token-contract.test.ts',
      'frontend/src/styles/custom.css',
      'frontend/src/components/ui/controls/button.module.css',
      'frontend/src/components/ui/controls/status.module.css',
      'frontend/src/components/copilot/SimpleChat.tsx',
      'docs/design-charter.md',
    ]) {
      assert.equal(fs.existsSync(path.join(ROOT, f)), true, `${f} 零回归基线不得被破坏`);
    }
  });
});
