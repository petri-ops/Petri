import { describe, expect, it } from 'vitest';
import { mergeToolCallActivity, mergeToolResultActivity } from './toolActivity';

describe('diag: shellLabel wiring', () => {
  it('sets shellLabel from result.data.shell', () => {
    let items = mergeToolCallActivity([], {
      name: 'workspace_exec',
      callId: 'call_diag',
      args: { command: "Write-Output '中文输出测试 OK'", shell: 'powershell' },
    });
    expect(items[0]?.command).toContain('Write-Output');
    items = mergeToolResultActivity(items, {
      name: 'workspace_exec',
      summary: 'ok',
      toolResult: {
        callId: 'call_diag',
        tool: 'workspace_exec',
        status: 'success',
        durationMs: 100,
        data: {
          ok: true,
          command: "Write-Output '中文输出测试 OK'",
          shell: 'C:\\windows\\system32\\cmd.exe',
          exitCode: 0,
        },
      },
    } as never);
    console.log('shellLabel:', items[0]?.shellLabel, 'command:', items[0]?.command?.slice(0, 30));
    expect(items[0]?.shellLabel).toBe('cmd');
  });
});
