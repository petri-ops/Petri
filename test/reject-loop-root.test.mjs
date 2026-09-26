// BLOCK-125 — reject→agent 回路拓扑修复契约（红绿先行：本文件先于实现落盘）。
// 根因：写侧（Electron main IPC）落盘 app.getPath('userData')，读侧（agent-runner）只认
// BIOF3_USER_DATA_DIR——测试实例（独立 userData + 复用 :3001 后端）与独立裸后端拓扑下
// 读写两侧指向不同目录=回路断裂（BLOCK-85 脑裂家族）。
// 修法契约：拒绝清单根目录解析统一优先 BIOF3_LOCAL_DATA_DIR（全拓扑共享），USER_DATA_DIR 回退。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require_ = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const helper = await import('../core/biof3-server/helpers/system-prompt.js');
const { resolveWorkingTreeRejectRoot, loadWorkingTreeRejectEntries } = helper;

test('resolveWorkingTreeRejectRoot：LOCAL_DATA_DIR 优先于 USER_DATA_DIR', () => {
  const r = resolveWorkingTreeRejectRoot({ BIOF3_LOCAL_DATA_DIR: 'D:/shared/data', BIOF3_USER_DATA_DIR: 'D:/user/data' });
  assert.equal(r, 'D:/shared/data');
});

test('resolveWorkingTreeRejectRoot：USER_DATA_DIR 回退；双缺失返回 null', () => {
  assert.equal(resolveWorkingTreeRejectRoot({ BIOF3_USER_DATA_DIR: 'D:/user/data' }), 'D:/user/data');
  assert.equal(resolveWorkingTreeRejectRoot({}), null);
  assert.equal(resolveWorkingTreeRejectRoot(undefined), null);
});

test('写读收敛：_writeRejectEntry 落盘到解析根 → loadWorkingTreeRejectEntries 同根可读', () => {
  const rejectStore = require_('../src/ipc/working-tree-review/reject-store.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reject-loop-fx-'));
  try {
    rejectStore._writeRejectEntry(tmp, {
      taskId: 'task-fx-1',
      file: 'src/foo.ts',
      hunkIndex: 0,
      feedback: '测试拒绝理由',
    });
    const entries = loadWorkingTreeRejectEntries(tmp, { limit: 10 });
    assert.ok(entries.length >= 1);
    const hit = entries.find((e) => e.file === 'src/foo.ts');
    assert.ok(hit, '同根写入可读出');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('源码扫描守卫：IPC 写侧（working-tree-review.js）拒绝落盘使用 LOCAL_DATA_DIR 优先解析', () => {
  // CK-11 批次四同款源码扫描守卫：src 侧受 quality:arch R5 限制不能 require core helper，
  // 以源文本锚点钉住两侧解析口径一致（修改解析规则时两侧必须同批改）。
  const src = fs.readFileSync(path.join(ROOT, 'src', 'ipc', 'working-tree-review.js'), 'utf8');
  assert.ok(
    /BIOF3_LOCAL_DATA_DIR/.test(src),
    'IPC 写侧必须含 BIOF3_LOCAL_DATA_DIR 优先解析',
  );
  // 两处 _writeRejectEntry 调用点都必须经解析函数（不得直连 app.getPath('userData')）
  const callSites = src.match(/_writeRejectEntry\([^;]*\)/g) || [];
  assert.ok(callSites.length >= 2, `应有 >=2 处调用点，实测 ${callSites.length}`);
  for (const call of callSites) {
    assert.ok(
      /resolveRejectRootDir|resolveWorkingTreeRejectRoot/.test(call),
      '调用点必须经解析函数',
    );
  }
});
