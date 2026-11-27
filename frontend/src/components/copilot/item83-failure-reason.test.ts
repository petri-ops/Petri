/** item83 第二轮 HK-01：失败原因必须进活动行，不再只显示 handler_error。 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');

describe('item83 失败原因卡', () => {
  it('HK-01 ToolActivityItem 带 message 且两处失败行渲染原因', () => {
    const activity = read('toolActivity.ts');
    const list = read('ToolActivityList.tsx');
    expect(activity).toContain('message?: string');
    expect(activity).toContain('message: typeof raw.message');
    expect(list.match(/data-testid="tool-failure-reason"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(list).toContain('失败原因：');
  });
});
