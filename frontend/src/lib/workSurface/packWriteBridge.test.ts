/**
 * RW-02 B 线 — pack 写桥宿主侧契约（前端移植与分发）。
 *
 * 契约：与 core/shared-backend/pack-write-bridge-contract.js 同词汇同 fail-closed 行为
 * （R4 禁 import，同源移植漂移由两侧测试对账）；分发到核心客户端（mock 注入）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  PACK_WRITE_KINDS,
  evaluateWriteGrant,
  validatePackWriteMessage,
  createWriteRequestDedupe,
  createPackWriteHost,
} from './packWriteBridge';

const createAnnotation = vi.fn();
const deleteAnnotation = vi.fn();
const restoreArtifactRevision = vi.fn();
const coreFetch = vi.fn();

vi.mock('@/lib/annotation-client', () => ({
  createAnnotation: (...args: unknown[]) => createAnnotation(...args),
  deleteAnnotation: (...args: unknown[]) => deleteAnnotation(...args),
}));
vi.mock('@/components/result-studio/resultStudioClient', () => ({
  restoreArtifactRevision: (...args: unknown[]) => restoreArtifactRevision(...args),
}));
vi.mock('@/lib/authToken', () => ({ getToken: () => 'test-token' }));

beforeEach(() => {
  createAnnotation.mockReset();
  deleteAnnotation.mockReset();
  restoreArtifactRevision.mockReset();
  coreFetch.mockReset();
  vi.stubGlobal('fetch', coreFetch);
});

const DECL = {
  bridgeVersion: 1,
  annotations: { write: true },
  selection: { write: true },
  revisions: { restore: true, replay: true },
  export: { run: true },
};

describe('RW02 packWriteBridge host', () => {
  it('词汇与后端契约同形（对账锚）', () => {
    expect([...PACK_WRITE_KINDS].sort()).toEqual([
      'annotation-delete', 'annotation-write', 'export-run', 'revision-replay', 'revision-restore', 'selection-save',
    ]);
  });

  it('校验：v1 别名归一 + fail-closed', () => {
    const alias = validatePackWriteMessage({ type: 'petri:annotation-delete', requestId: 'r1', annotationId: 'a1' });
    expect(alias.ok).toBe(true);
    expect(alias.ok && alias.message.kind).toBe('annotation-delete');
    expect(validatePackWriteMessage({ type: 'petri:pack-write', requestId: 'r2', kind: 'nope', payload: {} }).ok).toBe(false);
    expect(validatePackWriteMessage({ type: 'petri:pack-write', requestId: 'r3', kind: 'export-run', payload: { format: 'virus' } }).ok).toBe(false);
  });

  it('授权：未声明拒绝 + 粒度隔离', () => {
    expect(evaluateWriteGrant(null, 'selection-save').granted).toBe(false);
    expect(evaluateWriteGrant({ bridgeVersion: 1, selection: { write: true } }, 'revision-restore').granted).toBe(false);
    expect(evaluateWriteGrant(DECL, 'revision-restore').granted).toBe(true);
  });

  it('分发：annotation-write 注入宿主 scope + selection-save 注入项目归属 + restore 走核心客户端', async () => {
    createAnnotation.mockResolvedValue({ annotation: { id: 'ann_1' }, count: 3 });
    coreFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ selectionId: 'sel_9' }) });
    restoreArtifactRevision.mockResolvedValue({ revision: { revisionId: 'rev_2' }, changeSet: { changeSetId: 'cs_1' } });

    const host = createPackWriteHost({
      surfaceDecl: DECL,
      projectId: 'p_1',
      conversationId: 'conv_1',
      annotationScope: { projectId: 'p_1', artifactId: 'art_1' } as never,
    });
    const annResult = await host.handlePackWrite({
      type: 'petri:annotation-write', requestId: 'req-ann', comment: '看这里', rect: [0, 0, 10, 10],
    });
    expect(annResult.ok).toBe(true);
    expect(createAnnotation).toHaveBeenCalledTimes(1);
    expect(createAnnotation.mock.calls[0][0]).toMatchObject({ projectId: 'p_1', artifactId: 'art_1', conversationId: 'conv_1', comment: '看这里' });

    const selResult = await host.handlePackWrite({
      type: 'petri:pack-write', requestId: 'req-sel',
      kind: 'selection-save',
      payload: { selection: { contractVersion: 1, entityType: 'gene', entityIds: ['TP53'], entityIdCount: 1 } },
    });
    expect(selResult.ok).toBe(true);
    const body = JSON.parse(String(coreFetch.mock.calls[0][1].body));
    expect(body.projectId).toBe('p_1');

    const restoreResult = await host.handlePackWrite({
      type: 'petri:pack-write', requestId: 'req-restore', kind: 'revision-restore', payload: { revisionId: 'rev_1' },
    });
    expect(restoreResult.ok).toBe(true);
    expect(restoreArtifactRevision).toHaveBeenCalledWith('rev_1');
  });

  it('防重放：同 requestId 二次写被拒且不触达核心客户端', async () => {
    coreFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ selectionId: 'sel_1' }) });
    const host = createPackWriteHost({
      surfaceDecl: DECL, projectId: 'p_1', conversationId: null, annotationScope: null,
    });
    const message = {
      type: 'petri:pack-write', requestId: 'req-dup', kind: 'selection-save',
      payload: { selection: { contractVersion: 1, entityType: 'gene', entityIds: ['TP53'], entityIdCount: 1 } },
    };
    expect((await host.handlePackWrite(message)).ok).toBe(true);
    const second = await host.handlePackWrite(message);
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.error).toBe('replay_duplicate');
    expect(coreFetch).toHaveBeenCalledTimes(1);
  });

  it('TTL 去重原语与后端契约同形', () => {
    const dedupe = createWriteRequestDedupe({ ttlMs: 30 });
    expect(dedupe.claim('a').ok).toBe(true);
    const replay = dedupe.claim('a');
    expect(replay.ok).toBe(false);
    expect(replay.ok === false && replay.reason).toBe('replay_duplicate');
  });
});
