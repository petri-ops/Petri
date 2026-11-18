import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import {
  collectPerformanceTrust,
  validatePerformanceTrustIntegrity,
  scanStreamingProjection,
  scanMemoBoundary,
  scanSseResume,
  scanTrustStateMachine,
  scanRenderSkeleton,
  READING_IDS,
  TRUST_FLOOR,
} from '../scripts/c53-performance-trust.mjs';
import { STATE_MATRIX } from '../scripts/ui-design-a11y.mjs';

// BLOCK-474 / C-53 S4 P5 — HK-01 红绿先行 + 篡改负测。
// 可信态/性能契约必须从真源机械派生并被本测试锚定：
// ① 快照六组读数结构完整 ② 逐读数现读一致（可复算）③ 流式投影可信态
// ④ memo 渲染边界 ⑤ SSE 断线续传 ⑥ 加载/空/错误状态机 ⑦ 首屏占位
// ⑧ 观感留槽 zero 代签 ⑨ manifest sha256 ⑩ 篡改负测 fail-closed ⑪ P0–P4 零回归。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = path.join(ROOT, 'acceptance/block474-c53-p5-performance-trust/performance-trust-snapshot.json');
const CONTRACT = path.join(ROOT, 'resources/design-context/performance-trust.json');
const MANIFEST = path.join(ROOT, 'resources/design-context/manifest.json');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const ownGet = (obj, key) => Object.entries(obj ?? {}).find(([k]) => k === key)?.[1];

describe('C-53 P5 性能与可信状态契约可复算（HK-01）', () => {
  it('快照与契约在场且结构完整（六组读数带 value/source/command/capturedAt）', () => {
    assert.equal(fs.existsSync(SNAPSHOT), true, 'performance-trust-snapshot.json 必须在场');
    assert.equal(fs.existsSync(CONTRACT), true, 'performance-trust.json 必须在场');
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    assert.equal(snap.kind, 'c53-performance-trust');
    assert.deepEqual(Object.keys(snap.readings).sort(), [...READING_IDS].sort());
    const check = validatePerformanceTrustIntegrity(snap.readings);
    assert.equal(check.ok, true, `完整性: ${check.issues.join('; ')}`);
  });

  it('逐读数现读一致（collectPerformanceTrust 重算与落盘 value 深等）', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const fresh = collectPerformanceTrust(ROOT);
    for (const id of READING_IDS) {
      assert.deepEqual(
        ownGet(fresh, id).value,
        ownGet(snap.readings, id).value,
        `读数 ${id} 与现真源漂移（快照过期或真源变更未重算）`,
      );
    }
  });

  it('流式投影：pending 强制 / compose→pending 替换 / completed 升级在场 + 8 条契约 it', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const s = ownGet(snap.readings, 'streamingProjection').value;
    assert.equal(s.streamingForcesPending, true, 'streaming 分支必须强制 pending');
    assert.equal(s.composeToPending, true, 'compose→pending 替换必须在场');
    assert.equal(s.completedUpgrade, true, 'completed 升级路径必须在场');
    assert.equal(s.pureContentProjection, true, '纯函数 content 投影必须在场');
    assert.equal(s.jsonPrefixGuard, true, '嵌套 JSON 前缀判据必须在场');
    assert.ok(s.contractItCount >= TRUST_FLOOR.streamingContractIts, '流式契约 it 数不得低于冻结下限');
  });

  it('memo 渲染边界：React.memo + 三条 memo 契约 it 在场', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const m = ownGet(snap.readings, 'memoBoundary').value;
    assert.equal(m.reactMemo, true, 'React.memo 必须在场');
    assert.equal(m.bailOutIt, true, 'bail-out 契约 it 必须在场');
    assert.equal(m.identityBreakIt, true, '身份击穿契约 it 必须在场');
    assert.equal(m.callbackIdentityIt, true, '回调身份契约 it 必须在场');
    assert.ok(m.contractItCount >= TRUST_FLOOR.memoContractIts, 'memo 契约 it 数不得低于冻结下限');
  });

  it('SSE 断线续传：afterSeq / [DONE] 哨兵 / 跨 chunk 归并 / ping 透明 / 负测在场', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const r = ownGet(snap.readings, 'sseResume').value;
    for (const k of Object.keys(TRUST_FLOOR.sseContracts)) {
      assert.equal(ownGet(r, k), true, `SSE 契约 ${k} 必须在场`);
    }
    assert.ok(r.contractTestCount >= TRUST_FLOOR.sseContractTests, 'SSE 契约测试数不得低于冻结下限');
    assert.equal(r.parserInPlace, true, 'parseSseStream 纯函数必须在场');
  });

  it('可信态状态机：loading/empty/error 12 格 + role=alert/status/aria-busy 证据 >0', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const t = ownGet(snap.readings, 'trustStateMachine').value;
    assert.equal(t.trustCells, 12, 'loading/empty/error × 4 kinds = 12 格');
    assert.equal(t.complete, true, '12 格判据必须完整');
    for (const [k, v] of Object.entries(t.evidence)) {
      assert.ok(v > 0, `可信态证据 ${k} 缺失`);
    }
    assert.equal(t.cells, STATE_MATRIX.length, '全矩阵读数须对齐 STATE_MATRIX');
  });

  it('首屏占位：compose-stream-pending + 四条流式渲染接线契约在场', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const s = ownGet(snap.readings, 'renderSkeleton').value;
    assert.equal(s.pendingTestId, true, 'compose-stream-pending 占位必须在场');
    assert.equal(s.partialPlaceholderIt, true, 'partial 占位契约 it 必须在场');
    assert.equal(s.fullStillPlaceholderIt, true, '完整仍占位契约 it 必须在场');
    assert.equal(s.plainTextFastPathIt, true, '纯文本快路径契约 it 必须在场');
    assert.equal(s.fenceExemptIt, true, '围栏豁免契约 it 必须在场');
    assert.ok(s.contractItCount >= TRUST_FLOOR.skeletonContractIts, '接线 it 数不得低于冻结下限');
  });

  it('观感留槽：pending_human_eye 保持 in_progress，零代签', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const h = ownGet(snap.readings, 'humanEyeSlots').value;
    assert.equal(h.humanEyeSigned, false, 'Agent 永不代签观感');
    assert.equal(h.status, 'in_progress', '观感项必须保持 in_progress');
    assert.ok(h.slots.length >= TRUST_FLOOR.humanEyeSlots, '观感槽清单不得空');
    assert.equal(h.readOnly, true);
  });

  it('manifest sha256 与 performance-trust.json 实际字节一致', () => {
    const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const entry = (m.files || []).find((f) => ownGet(f, 'path') === 'performance-trust.json');
    assert.ok(entry, 'manifest 必须登记 performance-trust.json');
    assert.equal(ownGet(entry, 'sha256'), sha256(fs.readFileSync(CONTRACT)), 'sha256 一致');
  });

  it('篡改负测 fail-closed：符号清零 / 证据归零 / 结构破坏都被判红', () => {
    // 流式投影注入空源 → 语义符号全 false（key 用扫描器读取的完整相对路径）
    const emptyStream = scanStreamingProjection(ROOT, {
      'frontend/src/components/copilot/gen-ui/referencesStreaming.ts': 'export function projectStreamingCompose() { return null; }',
      'frontend/src/components/copilot/gen-ui/references.ts': 'export function projectGenUiReferences() { return []; }',
      'frontend/src/components/copilot/gen-ui/references-streaming.test.ts': '// empty',
    });
    assert.equal(emptyStream.streamingForcesPending, false, '空源必丢失 pending 强制');
    assert.equal(emptyStream.composeToPending, false, '空源必丢失 compose→pending 替换');

    // memo 注入空源 → React.memo 缺失
    const emptyMemo = scanMemoBoundary(ROOT, {
      'frontend/src/components/copilot/SimpleChat/SimpleChatMessageRow.tsx': 'export const X = 1;',
      'frontend/src/components/copilot/SimpleChat/SimpleChatMessageRow.test.tsx': '// empty',
    });
    assert.equal(emptyMemo.reactMemo, false, '空源必丢失 React.memo');

    // SSE 注入空源 → 契约全 false
    const emptySse = scanSseResume(ROOT, {
      'test/m4-sse-real-endpoint.test.mjs': '// empty',
      'scripts/lib-sse-frames.mjs': '// empty',
    });
    for (const k of Object.keys(TRUST_FLOOR.sseContracts)) {
      assert.equal(ownGet(emptySse, k), false, `空源必丢失 SSE 契约 ${k}`);
    }

    // 状态机注入空源 → 证据全 0
    const emptySm = scanTrustStateMachine(ROOT, { 'empty.tsx': '<div/>' });
    for (const v of Object.values(emptySm.evidence)) assert.equal(v, 0, '空源证据必归零');

    // 首屏占位注入空源 → 契约全 false
    const emptySkel = scanRenderSkeleton(ROOT, {
      'frontend/src/components/copilot/gen-ui/GenUiMessageContent.tsx': '// empty',
      'frontend/src/components/copilot/gen-ui/GenUiMessageContent.streaming.test.tsx': '// empty',
    });
    assert.equal(emptySkel.pendingTestId, false, '空源必丢失 compose-stream-pending');

    // 结构完整性：抽掉一组读数 → 红
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const broken = structuredClone(snap.readings);
    delete broken.sseResume;
    assert.equal(validatePerformanceTrustIntegrity(broken).ok, false, '缺读数必红');

    // 契约读数漂移 → 与落盘深等失败
    const forged = structuredClone(snap.readings);
    ownGet(forged, 'memoBoundary').value.reactMemo = false;
    assert.notDeepEqual(ownGet(forged, 'memoBoundary').value, ownGet(collectPerformanceTrust(ROOT), 'memoBoundary').value);
  });

  it('P0/P1/P2/P3/P4 + B466/B154/M55 零回归：既有契约产物全在场', () => {
    const dir = path.join(ROOT, 'resources/design-context');
    for (const f of ['design-context.json', 'ia-map.json', 'visual-consistency.json', 'responsive-a11y.json', 'performance-trust.json']) {
      assert.equal(fs.existsSync(path.join(dir, f)), true, `${f} 不得被破坏`);
    }
    for (const f of [
      'test/c53-design-context-pack.test.mjs',
      'test/c53-ia-map.test.mjs',
      'test/c53-visual-consistency.test.mjs',
      'test/c53-responsive-a11y.test.mjs',
      'frontend/src/components/copilot/gen-ui/references-streaming.test.ts',
      'frontend/src/components/copilot/SimpleChat/SimpleChatMessageRow.test.tsx',
      'test/m4-sse-real-endpoint.test.mjs',
    ]) {
      assert.equal(fs.existsSync(path.join(ROOT, f)), true, `${f} 零回归基线不得被破坏`);
    }
  });
});
