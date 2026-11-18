import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import {
  collectResponsiveA11y,
  validateResponsiveA11yIntegrity,
  scanBreakpoints,
  scanAriaStateMachine,
  scanTouchTargets,
  READING_IDS,
  BREAKPOINT_FLOOR,
} from '../scripts/c53-responsive-a11y.mjs';
import { STATE_MATRIX, WCAG_AA_BODY, WCAG_AA_LARGE } from '../scripts/ui-design-a11y.mjs';

// BLOCK-473 / C-53 S3 P4 — HK-01 红绿先行 + 篡改负测。
// 响应式 a11y 契约必须从真源机械派生并被本测试锚定：
// ① 快照六组读数现读一致（可复算）② 键盘/焦点只减棘轮 ③ ARIA 状态机四类证据
// ④ WCAG 对比度阈值不放宽 ⑤ 断点覆盖下限 ⑥ 触摸目标尺寸 ⑦ 八态矩阵
// ⑧ manifest sha256 ⑨ 篡改负测 fail-closed ⑩ P0/P1/P2/P3 + 双真源零回归。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = path.join(ROOT, 'acceptance/block473-c53-p4-responsive-a11y/responsive-a11y-snapshot.json');
const CONTRACT = path.join(ROOT, 'resources/design-context/responsive-a11y.json');
const MANIFEST = path.join(ROOT, 'resources/design-context/manifest.json');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const ownGet = (obj, key) => Object.entries(obj ?? {}).find(([k]) => k === key)?.[1];

describe('C-53 P4 响应式 a11y 契约可复算（HK-01）', () => {
  it('快照与契约在场且结构完整（六组读数带 value/source/command/capturedAt）', () => {
    assert.equal(fs.existsSync(SNAPSHOT), true, 'responsive-a11y-snapshot.json 必须在场');
    assert.equal(fs.existsSync(CONTRACT), true, 'responsive-a11y.json 必须在场');
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    assert.equal(snap.kind, 'c53-responsive-a11y');
    assert.deepEqual(Object.keys(snap.readings).sort(), [...READING_IDS].sort());
    const check = validateResponsiveA11yIntegrity(snap.readings);
    assert.equal(check.ok, true, `完整性: ${check.issues.join('; ')}`);
  });

  it('逐读数现读一致（collectResponsiveA11y 重算与落盘 value 深等）', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const fresh = collectResponsiveA11y(ROOT);
    for (const id of READING_IDS) {
      assert.deepEqual(
        ownGet(fresh, id).value,
        ownGet(snap.readings, id).value,
        `读数 ${id} 与现真源漂移（快照过期或真源变更未重算）`,
      );
    }
  });

  it('键盘/焦点：focus 缺口不超冻结基线（只减棘轮）+ 键盘隔离语义在场', () => {
    const fresh = collectResponsiveA11y(ROOT);
    const kf = ownGet(fresh, 'keyboardFocus').value;
    assert.equal(kf.overRatchet, false, 'focus 缺口不得超冻结 12/16 基线');
    assert.ok(kf.focusGapFiles <= kf.frozenFiles);
    assert.ok(kf.focusGapDeclarations <= kf.frozenDeclarations);
    assert.equal(kf.keyboardIsolationPresent, true, 'inert + :focus-visible 语义须在场');
    assert.ok(kf.inertOccurrences > 0 && kf.focusVisibleRules > 0);
  });

  it('ARIA 状态机：四类证据逐项 >0', () => {
    const sm = scanAriaStateMachine(ROOT);
    for (const [k, v] of Object.entries(sm)) {
      assert.ok(v > 0, `状态机证据 ${k} 缺失`);
    }
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    assert.deepEqual(ownGet(snap.readings, 'ariaStateMachine').value, sm);
  });

  it('WCAG 对比度：32 对 + 阈值不放宽 + 低于阈值对如实登记', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const c = ownGet(snap.readings, 'contrast').value;
    assert.equal(c.pairCount, 32);
    assert.equal(c.bodyThreshold, WCAG_AA_BODY);
    assert.equal(c.largeThreshold, WCAG_AA_LARGE);
    assert.equal(c.thresholdsNotRelaxed, true);
    assert.equal(c.belowBodyCount, c.belowBody.length);
  });

  it('断点：现读不低冻结下限 + 窄屏覆盖在场 + 可复算', () => {
    const fresh = scanBreakpoints();
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const frozen = ownGet(snap.readings, 'breakpoints').value;
    assert.deepEqual(fresh, frozen, '断点读数与落盘深等');
    assert.ok(fresh.media >= BREAKPOINT_FLOOR.media, '@media 计数不得低冻结下限');
    assert.ok(fresh.container >= BREAKPOINT_FLOOR.container, '@container 计数不得低冻结下限');
    assert.ok(fresh.widthStepCount >= BREAKPOINT_FLOOR.widthStepCount);
    assert.equal(fresh.narrowCoverage, true, '窄屏断点覆盖须在场');
  });

  it('触摸目标：控件基形 24/30px 现读 + 桌面形态声明（观感不代签）', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const t = ownGet(snap.readings, 'touchTargets').value;
    assert.equal(t.iconBasePx, 24);
    assert.equal(t.standardBaseHeightPx, 30);
    assert.equal(t.wcagTargetMinPx, 24);
    assert.equal(t.iconMeetsMinimum, true);
    assert.equal(t.standardMeetsMinimum, true);
    assert.equal(t.desktopFormFactor, true);
  });

  it('八态矩阵：32 格完整 + 人眼格如实标注', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const m = ownGet(snap.readings, 'eightStateMatrix').value;
    assert.equal(m.cells, 32);
    assert.equal(m.cells, STATE_MATRIX.length);
    assert.equal(m.complete, true);
    assert.ok(m.humanEyeCells > 0, 'pending_human_eye 格须如实标注');
  });

  it('manifest sha256 与 responsive-a11y.json 实际字节一致', () => {
    const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const entry = (m.files || []).find((f) => ownGet(f, 'path') === 'responsive-a11y.json');
    assert.ok(entry, 'manifest 必须登记 responsive-a11y.json');
    assert.equal(ownGet(entry, 'sha256'), sha256(fs.readFileSync(CONTRACT)), 'sha256 一致');
  });

  it('篡改负测 fail-closed：阈值放宽/断点删减/状态机清零/结构破坏都被判红', () => {
    // 断点注入少档 → 低于下限（纯函数形态，通过注入 sources 取窄集）
    const thinned = scanBreakpoints({ 'a.css': '@media (min-width: 900px) { .a{color:red} }' });
    assert.ok(thinned.media < BREAKPOINT_FLOOR.media, '断点删减必低于下限');
    assert.equal(thinned.narrowCoverage, false, '无窄屏断点必红');

    // 状态机注入空源 → 四类证据全 0
    const emptySm = scanAriaStateMachine(ROOT, { 'empty.tsx': '<div/>' });
    assert.deepEqual(emptySm, { ariaBusy: 0, roleAlert: 0, roleStatus: 0, ariaLive: 0 });

    // 触摸目标：伪造 iconBase 20px → 不达标
    const forgedBtn = '.iconBase { width: 20px; height: 20px; } .base { height: 30px; }';
    assert.equal(scanTouchTargets(forgedBtn).iconMeetsMinimum, false, '<24px 图标按钮必标注未达标');

    // 结构完整性：抽掉一组读数 → 红
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const broken = structuredClone(snap.readings);
    delete broken.contrast;
    assert.equal(validateResponsiveA11yIntegrity(broken).ok, false, '缺读数必红');

    // 契约读数漂移 → 与落盘深等失败
    const forged = structuredClone(snap.readings);
    ownGet(forged, 'ariaStateMachine').value.roleStatus = 0;
    assert.notDeepEqual(ownGet(forged, 'ariaStateMachine').value, ownGet(collectResponsiveA11y(ROOT), 'ariaStateMachine').value);
  });

  it('P0/P1/P2/P3 + 双真源零回归：既有契约产物全在场', () => {
    const dir = path.join(ROOT, 'resources/design-context');
    for (const f of ['design-context.json', 'ia-map.json', 'visual-consistency.json', 'responsive-a11y.json']) {
      assert.equal(fs.existsSync(path.join(dir, f)), true, `${f} 不得被破坏`);
    }
    assert.equal(fs.existsSync(path.join(ROOT, 'frontend/src/themes/nso-w3-a11y.test.tsx')), true);
    assert.equal(fs.existsSync(path.join(ROOT, 'test/ui-design-a11y.test.mjs')), true);
  });
});
