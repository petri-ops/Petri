import { describe, expect, it } from 'vitest';
import { shouldDowngradeToCore } from './usePackTabData';

/**
 * BLOCK-236 s2 — 降级判定三态。取数本身由 `packTabData.test.ts` 覆盖；
 * 这里只钉「host 什么时候必须回落核心」。
 */
describe('shouldDowngradeToCore（BLOCK-236）', () => {
  it('无 tab（模式主 body）不降级', () => {
    expect(shouldDowngradeToCore(undefined, { status: 'error', reason: 'http_500' })).toBe(false);
  });

  it('tab 加载中保持 pack（避免闪回核心）', () => {
    expect(shouldDowngradeToCore('lineage', { status: 'loading' })).toBe(false);
  });

  it('tab 就绪保持 pack', () => {
    expect(shouldDowngradeToCore('lineage', { status: 'ready' })).toBe(false);
  });

  it('tab 取数失败 → 降级核心（含 history 的 no_endpoint）', () => {
    expect(shouldDowngradeToCore('revisions-source', { status: 'error', reason: 'http_500' })).toBe(true);
    expect(shouldDowngradeToCore('history', { status: 'error', reason: 'no_endpoint' })).toBe(true);
  });
});
