/**
 * UI-406 — BackendStatusProvider 非桌面分支的真相映射契约。
 *
 * 历史缺陷：DEV 分支把 health 探测结果当作 rRuntime、pyRuntime 写死 false——
 * 手机投影里 127.0.0.1 探针恒不通，工作台假弹「R 与 Python 运行时均未安装」
 * （实机抓真：本机 R/Python 实际已装，/api/runtime/status 权威返回 installed=true）。
 * 修复后 DEV 分支消费 /api/runtime/status（BLOCK-86 权威探测），本测试锚定
 * mapRuntimeStatusPayload 的诚实语义：只有 `installed` 布尔值才回答缺失，
 * 载荷不可达 = null（未知）→ 消费端 `=== false` 严格判定不弹横幅。
 */
import { describe, expect, it } from 'vitest';
import { mapRuntimeStatusPayload, type RuntimeStatusPayload } from './BackendStatusProvider';

const INSTALLED = { installed: true };
const MISSING = { installed: false };

describe('mapRuntimeStatusPayload', () => {
  it('maps installed runtimes honestly (the projection false-banner regression)', () => {
    const status = mapRuntimeStatusPayload(
      { ok: true, runtime: { r: INSTALLED, python: { installed: true } } },
      true,
    );
    expect(status.rRuntime).toBe(true);
    expect(status.pyRuntime).toBe(true);
    expect(status.isReady).toBe(true);
    expect(status.downReason).toBeNull();
    expect(status.loaded).toBe(true);
  });

  it('maps confirmed-missing runtimes to false (the only shape that may raise the banner)', () => {
    const status = mapRuntimeStatusPayload(
      { ok: true, runtime: { r: MISSING, python: MISSING } },
      true,
    );
    expect(status.rRuntime).toBe(false);
    expect(status.pyRuntime).toBe(false);
  });

  it('keeps mixed states distinct (R installed, Python missing)', () => {
    const status = mapRuntimeStatusPayload(
      { ok: true, runtime: { r: INSTALLED, python: MISSING } },
      true,
    );
    expect(status.rRuntime).toBe(true);
    expect(status.pyRuntime).toBe(false);
  });

  it('returns null (unknown) — not false — when the runtime payload is unreachable', () => {
    const status = mapRuntimeStatusPayload(null, true);
    expect(status.rRuntime).toBeNull();
    expect(status.pyRuntime).toBeNull();
  });

  it('returns null (unknown) when the payload lacks the runtime field', () => {
    const payload = { ok: false } as RuntimeStatusPayload;
    const status = mapRuntimeStatusPayload(payload, false);
    expect(status.rRuntime).toBeNull();
    expect(status.pyRuntime).toBeNull();
    expect(status.isReady).toBe(false);
    expect(status.downReason).toBe('本地分析服务尚未就绪');
  });
});
