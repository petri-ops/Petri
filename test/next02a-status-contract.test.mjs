import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const read = (relative) => readFileSync(resolve(root, relative), 'utf8');

test('NEXT-02A: 高频状态面统一消费 statusProjection，不保留本地标签表', () => {
  const surfaces = [
    'frontend/src/components/work-surface/TraceSurface.tsx',
    'frontend/src/components/work-surface/EvidenceSurface.tsx',
    'frontend/src/components/workspace-panels/ResultsLibrary.tsx',
    'frontend/src/components/workspace-panels/WorkspaceSummaryCard.tsx',
    'frontend/src/components/copilot/ToolActivityList.tsx',
    'frontend/src/pages/window/CommandCenterJobsWall.tsx',
  ];
  for (const path of surfaces) {
    const source = read(path);
    assert.match(source, /projectExecutionAxis|projectEvidenceAxis|StatusBadge/, `${path} 必须消费统一状态投影`);
    assert.doesNotMatch(source, /const\s+(TASK_STATE_LABEL|STATUS_LABEL|TOOL_STATUS_LABEL|SUB_STATUS_LABEL)/, `${path} 不得复活本地状态标签表`);
  }
});

test('NEXT-02A: 三轴徽标暴露轴/状态/tone，未知状态不伪装成功', () => {
  const source = read('frontend/src/components/ui/controls/Status.tsx');
  assert.match(source, /data-axis=/);
  assert.match(source, /data-status=/);
  assert.match(source, /data-tone=/);
  assert.match(source, /projection\?\.status \|\| 'unknown'/);
});

test('NEXT-02A: 轨迹读取有界超时，不留下无限加载', () => {
  const source = read('frontend/src/lib/trajectoryClient.ts');
  assert.match(source, /DEFAULT_TRAJECTORY_TIMEOUT_MS/);
  assert.match(source, /trajectory_timeout/);
  assert.match(source, /clearTimeout\(timer\)/);
});
