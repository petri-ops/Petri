/**
 * BLOCK-159 P1-8 — 投影链路状态/resync 总线契约。
 *
 * 契约：①mark 失败/成功驱动状态转移并通知订阅方（同态重复上报不通知）；
 * ②onProjectionResync 派发全部订阅方且单方异常不阻断其余；③桌面环境
 * （无 document）install 幂等且零行为；④回前台（visibilitychange→visible）
 * 派发 resync。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  getProjectionLinkStatus,
  markProjectionBridgeFailure,
  markProjectionBridgeSuccess,
  onProjectionLinkChange,
  onProjectionResync,
  requestProjectionResync,
  installProjectionResyncListener,
} from './projectionLink';

describe('projectionLink 状态总线', () => {
  beforeEach(() => {
    // 复位到 online：success 驱动（幂等 no-op if already online）
    markProjectionBridgeSuccess();
  });

  it('失败→离线并通知；成功→回线并通知；同态重复上报不通知', () => {
    const seen: Array<'online' | 'offline'> = [];
    const off = onProjectionLinkChange((s) => seen.push(s));

    markProjectionBridgeFailure('network');
    expect(getProjectionLinkStatus()).toBe('offline');
    markProjectionBridgeFailure('network-again'); // 同态重复：不通知
    markProjectionBridgeSuccess();
    markProjectionBridgeSuccess(); // 同态重复：不通知
    expect(getProjectionLinkStatus()).toBe('online');

    expect(seen).toEqual(['offline', 'online']);
    off();
  });

  it('退订后不再通知', () => {
    const seen: string[] = [];
    const off = onProjectionLinkChange((s) => seen.push(s));
    off();
    markProjectionBridgeFailure('x');
    expect(seen).toEqual([]);
    markProjectionBridgeSuccess();
  });

  it('resync 派发全部订阅方且单方异常不阻断其余', () => {
    const calls: string[] = [];
    const off1 = onProjectionResync(() => { calls.push('a'); });
    const off2 = onProjectionResync(() => { calls.push('b'); throw new Error('boom'); });
    const off3 = onProjectionResync(() => { calls.push('c'); });

    requestProjectionResync();
    expect(calls).toEqual(['a', 'b', 'c']);

    off1(); off2(); off3();
    requestProjectionResync();
    expect(calls).toEqual(['a', 'b', 'c']);
  });
});

describe('projectionLink 回前台 resync', () => {
  it('visibilitychange→visible 派发 resync；hidden 不派发', () => {
    installProjectionResyncListener();
    const cb = vi.fn();
    const off = onProjectionResync(cb);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(cb).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(cb).toHaveBeenCalledTimes(1);

    off();
  });

  it('install 幂等：重复安装只注册一个 visibilitychange 监听', () => {
    const spy = vi.spyOn(document, 'addEventListener');
    installProjectionResyncListener();
    const count = spy.mock.calls.filter(([type]) => type === 'visibilitychange').length;
    installProjectionResyncListener();
    const countAfter = spy.mock.calls.filter(([type]) => type === 'visibilitychange').length;
    expect(countAfter).toBe(count);
    spy.mockRestore();
  });
});
