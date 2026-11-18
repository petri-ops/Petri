import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import {
  collectReactBitsMotion,
  validateReactBitsMotionIntegrity,
  scanMotionTokens,
  scanBoundaries,
  READING_IDS,
  PATTERN_FLOOR,
  LICENSE_REGISTER,
} from '../scripts/c52-react-bits-motion.mjs';

// BLOCK-479 / C-52 P3（React Bits 反馈型微动效）—— HK-01 红绿先行 + 篡改负测。
// React Bits 反馈型微动效只做「模式借鉴 + 契约冻结」：Petri 已有本地主权动效锚点，
// 复用 --petri-duration/ease token，零新增产品依赖、不整页动效、观感 pending_human_eye 零代签。
// ① 快照/契约结构完整 ② 逐读数现读一致 ③ hover ④ press ⑤ expand ⑥ success
// ⑦ motion token 复用 ⑧ 边界（零依赖/禁整页/观感零签/许可证）⑨ manifest sha
// ⑩ 篡改负测 fail-closed ⑪ 零回归基线。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = path.join(ROOT, 'acceptance/block479-c52-p3-react-bits-motion/react-bits-motion-snapshot.json');
const CONTRACT = path.join(ROOT, 'resources/design-context/react-bits-motion.json');
const MANIFEST = path.join(ROOT, 'resources/design-context/manifest.json');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const ownGet = (obj, key) => Object.entries(obj ?? {}).find(([k]) => k === key)?.[1];

describe('C-52 P3 React Bits 反馈型微动效契约可复算（HK-01）', () => {
  it('快照与契约在场且结构完整（六组读数带 value/source/command/capturedAt）', () => {
    assert.equal(fs.existsSync(SNAPSHOT), true, 'react-bits-motion-snapshot.json 必须在场');
    assert.equal(fs.existsSync(CONTRACT), true, 'react-bits-motion.json 必须在场');
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    assert.equal(snap.kind, 'c52-react-bits-motion');
    assert.deepEqual(Object.keys(snap.readings).sort(), [...READING_IDS].sort());
    const check = validateReactBitsMotionIntegrity(snap.readings);
    assert.equal(check.ok, true, `完整性: ${check.issues.join('; ')}`);
  });

  it('逐读数现读一致（collectReactBitsMotion 重算与落盘 value 深等）', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const fresh = collectReactBitsMotion(ROOT);
    for (const id of READING_IDS) {
      assert.deepEqual(
        ownGet(fresh, id).value,
        ownGet(snap.readings, id).value,
        `读数 ${id} 与现真源漂移（快照过期或真源变更未重算）`,
      );
    }
  });

  it('hover：token 驱动悬停过渡 + hover 态基线在场', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const h = ownGet(snap.readings, 'hoverFeedback').value;
    assert.equal(h.tokenDrivenHover, true, 'hover 过渡必须引用 --petri-duration token');
    assert.equal(h.hoverStateBaseline, true, ':hover 反馈态必须在基线控件在场');
    assert.ok(h.hoverAnchors >= PATTERN_FLOOR.hoverAnchors, 'hover 锚点数不得低于冻结下限');
  });

  it('press：:active 缩放反馈在场（禁整页动效、仅局部按压）', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const p = ownGet(snap.readings, 'pressFeedback').value;
    assert.equal(p.activeScale, true, ':active transform scale 按压反馈必须在场');
    assert.equal(p.tokenDrivenPress, true, '按压过渡必须引用 --petri-duration token');
    assert.ok(p.activeAnchors >= PATTERN_FLOOR.activeAnchors, ':active 锚点数不得低于冻结下限');
  });

  it('expand：功能性布局过渡三容器 + reduced-motion 豁免在场', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const e = ownGet(snap.readings, 'expandFeedback').value;
    assert.ok(e.functionalOwners >= PATTERN_FLOOR.functionalOwners, '功能性过渡宿主数不得低于冻结下限');
    assert.equal(e.reducedMotionExemption, true, 'reduced-motion 功能性豁免必须在场');
    assert.equal(e.tokenDrivenExpand, true, '展开过渡必须引用 --petri-duration token');
  });

  it('success：成功态语义色 + 加载 spinner token 驱动 + reduced-motion 兜底在场', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const s = ownGet(snap.readings, 'successFeedback').value;
    assert.equal(s.toastSuccessVariant, true, '成功 toast data-variant=success + --petri-success 必须在场');
    assert.equal(s.spinnerToken, true, 'spinner 动画必须引用 --petri-duration-slow');
    assert.equal(s.reducedMotionFallback, true, '全局 reduced-motion 兜底必须在场');
  });

  it('motion token：三档 duration / 两档 ease / 宪章对齐 / 单调+字面量守卫在场', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const m = ownGet(snap.readings, 'motionTokens').value;
    assert.equal(m.durationTiers, PATTERN_FLOOR.durationTiers, 'duration 档数必须与冻结值一致');
    assert.equal(m.easeTiers, PATTERN_FLOOR.easeTiers, 'ease 档数必须与冻结值一致');
    assert.equal(m.charterAligned, true, 'design-charter §4 动效档值必须与 token 对齐');
    assert.equal(m.monotonicGuard, true, 'duration 单调断言必须在场');
    assert.equal(m.literalMsGuard, true, '禁字面 ms 新增守卫必须在场');
    assert.ok(m.tokenUses >= PATTERN_FLOOR.tokenUses, 'token 引用总数不得低于冻结下限');
  });

  it('边界：零新增依赖 / 禁整页动效 / 观感零代签 / 许可证来源记录在册', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const b = ownGet(snap.readings, 'boundaries').value;
    assert.equal(b.noNewDependency, true, '根/前端 package.json 不得出现 react-bits/framer-motion/assistant-ui/21st');
    assert.equal(b.noFullPageMotion, true, '全局 reduced-motion 兜底必须约束整页动效');
    assert.equal(b.humanEyeZeroSign, true, 'UI-706/707/709/710 必须 in_progress + pending_human_eye + 零 verified');
    assert.equal(Object.keys(b.licenseRegister).length, PATTERN_FLOOR.licenseSources, '许可证登记条数必须对齐冻结值');
    assert.deepEqual(b.licenseRegister, LICENSE_REGISTER, '快照许可证登记必须与冻结 register 一致');
  });

  it('manifest sha256 一致 + 契约模型可读标识在场', () => {
    const contractBuf = fs.readFileSync(CONTRACT);
    const contract = JSON.parse(contractBuf);
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const entry = manifest.files.find((f) => ownGet(f, 'path') === 'react-bits-motion.json');
    assert.ok(entry, 'manifest 必须登记 react-bits-motion.json');
    assert.equal(entry.sha256, sha256(contractBuf), 'manifest sha256 与契约文件不一致');
    assert.equal(contract.kind, 'model-readable-react-bits-motion');
    assert.equal(contract.boundaries.humanEyeSigned, false);
    assert.equal(contract.boundaries.readOnly, true);
    assert.equal(contract.boundaries.fullPageMotion, false);
  });

  it('篡改负测：改 token 真源/改依赖/改观感状态一律 fail-closed', () => {
    const fresh = collectReactBitsMotion(ROOT);
    const override = (id, value) => Object.fromEntries(
      READING_IDS.map((rid) => [rid, rid === id ? { ...ownGet(fresh, rid), value } : { ...ownGet(fresh, rid) }]),
    );
    const tamperedTokens = { ...ownGet(fresh, 'motionTokens').value, charterAligned: false };
    assert.equal(validateReactBitsMotionIntegrity(override('motionTokens', tamperedTokens)).ok, false);
    const tamperedDep = { ...ownGet(fresh, 'boundaries').value, noNewDependency: false };
    assert.equal(validateReactBitsMotionIntegrity(override('boundaries', tamperedDep)).ok, false);
    const tamperedEye = { ...ownGet(fresh, 'boundaries').value, humanEyeZeroSign: false };
    assert.equal(validateReactBitsMotionIntegrity(override('boundaries', tamperedEye)).ok, false);
    // 直接注入篡改真源：custom.css 删去 duration tier 后必须检测到缺席。
    const scanTampered = scanMotionTokens(ROOT, {
      'frontend/src/styles/custom.css': ':root { --petri-accent: #000; }',
    });
    assert.equal(scanTampered.durationTiers, 0, '删去 duration tier 的篡改源必须被检测');
    // 直接注入篡改依赖：package.json 加入 framer-motion 后 noNewDependency 必须翻红。
    const depTampered = scanBoundaries(ROOT, {
      'package.json': '{"dependencies":{"framer-motion":"^11.0.0"}}',
    });
    assert.equal(depTampered.noNewDependency, false, '新增 framer-motion 依赖的篡改源必须被检测');
  });

  it('零回归基线：P2 契约测试与动效真源文件在场', () => {
    for (const f of [
      'test/c52-assistant-ui-pattern.test.mjs',
      'test/c53-design-context-pack.test.mjs',
      'frontend/src/styles/theme-token-contract.test.ts',
      'frontend/src/styles/custom.css',
      'frontend/src/styles/global.css',
      'docs/design-charter.md',
      'frontend/src/components/ui/controls/status.module.css',
      'frontend/src/components/common/ToastProvider.module.css',
      'frontend/src/components/workspace-panels/LeftPanel.tsx',
    ]) {
      assert.equal(fs.existsSync(path.join(ROOT, f)), true, `${f} 零回归基线不得被破坏`);
    }
  });
});
