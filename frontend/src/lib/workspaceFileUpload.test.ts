import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { isTargetAlreadyExists, uploadBytesToWorkspace, uploadFileToWorkspace, WorkspaceUploadError } from './workspaceFileUpload';

const CHUNK = 64 * 1024;

interface RecordedCall {
  url: string;
  toPath: string;
  dataB64: string;
  offset: number;
}

const calls: RecordedCall[] = [];

function respond(jsonBody: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(jsonBody) } as unknown as Response;
}

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn((input: string, init?: { body?: BodyInit | null }) => {
    const bodyText = typeof init?.body === 'string' ? init.body : '{}';
    const body = JSON.parse(bodyText) as { toPath?: string; dataB64?: string; offset?: number };
    calls.push({
      url: String(input),
      toPath: String(body.toPath),
      dataB64: String(body.dataB64 || ''),
      offset: Number(body.offset),
    });
    return respond({ ok: true, entry: { type: 'file' } });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function bytesOf(length: number, seed = 1): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = (i * seed) % 251;
  return bytes;
}

describe('workspaceFileUpload 分片通道', () => {
  it('按 64KB 切片续写，offset 与内容逐片对齐', async () => {
    const bytes = bytesOf(CHUNK * 2 + 100);
    await uploadBytesToWorkspace('p1', 'model3d/assets/a.glb', bytes);
    expect(calls).toHaveLength(3);
    expect(calls.map((call) => call.offset)).toEqual([0, CHUNK, CHUNK * 2]);
    expect(calls.every((call) => call.url.includes('/workspaces/p1/fs/upload'))).toBe(true);
    const merged = new Uint8Array(bytes.length);
    calls.forEach((call, index) => {
      const chunk = Uint8Array.from(atob(call.dataB64), (character) => character.charCodeAt(0));
      merged.set(chunk, call.offset);
      expect(chunk.length).toBe(index === 2 ? 100 : CHUNK);
    });
    expect(merged).toEqual(bytes);
  });

  it('空文件只发一次 offset=0 空载荷', async () => {
    await uploadBytesToWorkspace('p1', 'model3d/assets/empty.stl', new Uint8Array(0));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ toPath: 'model3d/assets/empty.stl', dataB64: '', offset: 0 });
  });

  it('File 走同一切片语义（逐片读取，不整文件转 base64）', async () => {
    const bytes = bytesOf(CHUNK + 8);
    // TS 5.7 起 Uint8Array.buffer 是 ArrayBufferLike，Blob 构造只收 ArrayBuffer 视图。
    const file = new File([bytes.buffer as ArrayBuffer], 'head.STL', { type: 'model/stl' });
    await uploadFileToWorkspace('p1', 'model3d/assets/head.STL', file);
    expect(calls.map((call) => call.offset)).toEqual([0, CHUNK]);
    const total = calls.reduce((sum, call) => sum + atob(call.dataB64).length, 0);
    expect(total).toBe(bytes.length);
  });

  it('0 字节 File 也建空文件', async () => {
    await uploadFileToWorkspace('p1', 'model3d/assets/zero.obj', new File([], 'zero.obj'));
    expect(calls).toHaveLength(1);
    expect(calls[0].dataB64).toBe('');
  });

  it('服务端 409 带 code → WorkspaceUploadError.code 可判别（不靠文案）', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond({ ok: false, error: '目标已存在', code: 'target_already_exists' }, false, 409)));
    const error: unknown = await uploadBytesToWorkspace('p1', 'model3d/assets/a.glb', bytesOf(4)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WorkspaceUploadError);
    expect(isTargetAlreadyExists(error)).toBe(true);
    expect((error as WorkspaceUploadError).status).toBe(409);
  });

  it('非冲突错误不误判为已存在', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond({ ok: false, error: '分片超过 96KB 上限' }, false, 400)));
    const error: unknown = await uploadBytesToWorkspace('p1', 'model3d/assets/a.glb', bytesOf(4)).catch((caught: unknown) => caught);
    expect(isTargetAlreadyExists(error)).toBe(false);
    expect((error as Error).message).toBe('分片超过 96KB 上限');
  });
});
