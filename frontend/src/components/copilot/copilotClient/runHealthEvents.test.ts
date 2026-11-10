/**
 * B-07 四事件前端投影契约（红绿先行）。
 * 机械门禁归机械门禁：本测试钉映射与分派消费，不冒充 UI 在场 / 人眼观感。
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { mapRunHealthEvent, RUN_HEALTH_EVENT_CODES } from './runHealthEvents';

describe('B-07 运行健康四事件映射', () => {
  it('四个 reasonCode 都有可见文案与严重度', () => {
    expect(RUN_HEALTH_EVENT_CODES).toEqual([
      'compaction_failed', 'trim_skipped', 'provider_retry', 'stream_stall',
    ]);
    for (const code of RUN_HEALTH_EVENT_CODES) {
      const mapped = mapRunHealthEvent(code);
      expect(mapped).not.toBeNull();
      expect(mapped?.code).toBe(code);
      expect(mapped?.message.length).toBeGreaterThan(4);
      expect(['warning', 'error']).toContain(mapped?.severity);
    }
  });

  it('压缩失败是 error，其余是 warning；细节与次数进文案', () => {
    expect(mapRunHealthEvent('compaction_failed')?.severity).toBe('error');
    expect(mapRunHealthEvent('trim_skipped')?.severity).toBe('warning');
    expect(mapRunHealthEvent('provider_retry', { attempt: 3, detail: 'timeout' })?.message)
      .toContain('第 3 次');
    expect(mapRunHealthEvent('provider_retry', { attempt: 3, detail: 'timeout' })?.message)
      .toContain('timeout');
    expect(mapRunHealthEvent('stream_stall', { phase: 'first_token' })?.message)
      .toContain('first_token');
  });

  it('未知事件码天然 no-op（不误报、不吞事件）', () => {
    expect(mapRunHealthEvent('not_a_health_event')).toBeNull();
    expect(mapRunHealthEvent('')).toBeNull();
  });

  it('分派层真的消费映射（源码形态钉，防只写模块不接线）', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, 'agentTaskStream.ts'), 'utf8',
    );
    expect(src).toContain("mapRunHealthEvent");
    expect(src).toContain('onAgentStatus?.({ phase: health.code, message: health.message })');
    expect(src).toContain('RUN_HEALTH_EVENT_CODES');
  });
});
