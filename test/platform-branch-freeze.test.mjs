// BLOCK-104 P4 — process.platform 散落分支冻结登记门禁
//
// 背景：平台评估实锤 85 文件散落 process.platform 分支（win32:darwin 字面量 3:1
// Windows-first），平台知识靠「事故驱动补丁」而非入口约束。本门禁把基线冻结：
//   - 已登记文件维持现状（存量迁移走 platform-compat.js 扩面的独立增量）；
//   - 任何新文件引入 process.platform 读取 → fail-closed，提示走中央模块
//     （src/platform-compat.js）或显式登记进本基线（登记 = 有意识决策，留痕）。
// 基线口径：src/core/scripts/test 下 .js/.cjs/.mjs（排除 node_modules），文本含
// 「process.platform」即计入（读、传参、mock 均算——保守冻结）。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCAN_ROOTS = ['src', 'core', 'scripts', 'test'];
const BASELINE = new Set([
  // BLOCK-109 收口登记：scripts/block101-startup-timeline-live.cjs（BLOCK-106 P3 落地的
  // 实机 flow 采集脚本）内 process.platform 仅用于证据头 platform 字段与 darwin 采样
  // 门控——dev-only 一次性脚本，收敛到 platform-compat 收益为零，登记即留痕。
  'scripts/block101-startup-timeline-live.cjs',
  // BLOCK-176 W7 CP-21/22 — 技能依赖 preflight 面的 win32 差异（where/which、npm.cmd、
  // 平台门控展示字段）：探测原语属 OS 语义本身，收敛到 platform-compat 无收益，登记留痕。
  'core/shared-backend/skill-preflight.js',
  'core/petri-server/agent-tools/skill-tools.js',
  'core/petri-server/routes/projection-data.js',
  'scripts/block176-w7-live.mjs',
  // BLOCK-178 — 探针 win32 npm.cmd spawn 差异（Node spawnSync 对 .cmd 需 shell，同 W7 登记理由）
  'scripts/block178-live.mjs',
  // BLOCK-243 UI-551 — 隔离栈起停的 win32 taskkill 进程树差异（dev-only 一次性
  // 实机探针，收敛到 platform-compat 无收益），登记即留痕。
  'scripts/ui551-ui-live.mjs',
  // BLOCK-244 UI-552 — 同型隔离栈起停（win32 taskkill 进程树），dev-only 一次性探针。
  'scripts/block244-approval-tail-live.mjs',
  'core/petri-server/agent-tools/system-info-tools.js',
  'core/petri-server/agent-tools/workspace-tools.js',
  'core/petri-server/agent-tools/workspace-tools/internals.js',
  'core/petri-server/federation-terminal.js',
  'core/petri-server/helpers/chat-file-references.js',
  'core/petri-server/helpers/computer-use-host.js',
  'core/petri-server/helpers/credential-store.js',
  'core/petri-server/helpers/desktop-agent-prompt.js',
  'core/petri-server/helpers/remote-execution/ssh-multiplexer.js',
  'core/petri-server/mcp/ide-tools/diff.js',
  'core/petri-server/mobile-gateway/index.js',
  'core/petri-server/mobile-gateway/tunnel.js',
  'core/shared-backend/capability-bundles.js',
  // BLOCK-152 P 轨：宿主→平台键推导单源（deriveHostPlatform 缺省参数读宿主），
  // 三副本收敛落点——capability-bundles.js / build-r-bundle.mjs / runtime.js 的
  // 平台映射分支均迁入此处，登记即留痕。
  'core/shared-backend/host-platform.js',
  'core/shared-backend/executors/py-executor.js',
  'core/shared-backend/executors/r-executor.js',
  'core/shared-backend/result-studio-background.js',
  'core/shared-backend/result-studio-lifecycle.js',
  'core/shared-backend/runtime-paths.js',
  'core/shared-backend/runtime-resource-probe.js',
  'core/shared-backend/runtime-resource-snapshot.js',
  'core/shared-backend/tool-resource-sampler.js',
  'scripts/block63-p1-live.mjs',
  'scripts/block63-p4-live.cjs',
  'scripts/block83-p1-plugin-live.cjs',
  // BLOCK-152 P 轨收缩：build-r-bundle.mjs 的 currentPlatform 副本已删（改
  // require core/shared-backend/host-platform.js 单源），文件内已无
  // process.platform 读取，按基线存活纪律同步移出。
  'scripts/build-win-r-runtime-artifact.mjs',
  'scripts/build-win-runtime-artifact.mjs',
  'scripts/cdp-wrap.cjs',
  'scripts/dev-electron-profile.mjs',
  'scripts/dev-electron.js',
  'scripts/fix-r-paths.mjs',
  'scripts/g0-qualification-packaged.mjs',
  'scripts/g0-rs-p3-acceptance.mjs',
  'scripts/g0-rs-p5-acceptance.mjs',
  'scripts/g0-rs-p6-electron-pressure-prototype.mjs',
  'scripts/g0-rs-p6-real-restart-prototype.mjs',
  'scripts/g0-rs-p6-recovery-electron-prototype.mjs',
  'scripts/g0-rs-p7-acceptance.mjs',
  'scripts/g0-rs-ux1h-acceptance.mjs',
  'scripts/harness-plugin-acceptance.mjs',
  'scripts/install-core-deps.mjs',
  'scripts/ipc-backpressure-profile.mjs',
  'scripts/provision-win-python-runtime.mjs',
  'scripts/resume-py-runtime-zip.mjs',
  'scripts/test-affected.mjs',
  'scripts/ui351-summary-float-live.cjs',
  'scripts/verify-win-runtime-first-use.mjs',
  'src/ipc/auto-update.js',
  'src/ipc/diagnostic.js',
  'src/ipc/ssh-host.js',
  'src/ipc/terminal.js',
  'src/main.js',
  'src/main/_app-menu.js',
  'src/main/_window-create.js',
  'src/main/_window-ipc.js',
  'src/main/backend-proc-manager.js',
  'src/main/core-utils.js',
  'src/main/env-coordinator.js',
  'src/platform-compat.js',
  'src/plugin/runtime.js',
  'src/plugin/uninstall.js',
  'src/preload.js',
  'test/agent-files-changed.test.mjs',
  'test/agent-system-info.test.mjs',
  'test/agent-task-cancellation.test.mjs',
  'test/agent-task-subagent-recent.test.mjs',
  'test/agent-tool-policy.test.mjs',
  'test/agent-workspace-exec-background.test.mjs',
  'test/agent-workspace-exec-cwd-shell.test.mjs',
  'test/agent-workspace-exec-streaming.test.mjs',
  'test/agent-workspace-exec-yield.test.mjs',
  'test/block34-background-processes-route.test.mjs',
  'test/block48-computer-tools.test.mjs',
  'test/block63-computer-host.test.mjs',
  'test/block67-node-agent-fs.test.js',
  'test/block67-ssh-mux.test.mjs',
  'test/block88-project-grants.test.mjs',
  'test/block88-task-attribution.test.mjs',
  'test/chat-file-references.test.mjs',
  'test/credential-store.test.mjs',
  'test/federation.test.mjs',
  'test/g0-rs-p6-product-acceptance.test.mjs',
  'test/harness-workspace-tools.test.mjs',
  'test/p4r-live-observation.test.mjs',
  'test/remote-resource-snapshot.test.mjs',
  'test/result-studio-lifecycle.test.mjs',
  'test/scripts-platform-contract.test.mjs',
  'test/workspace-data-import.test.mjs'
]);

function scan() {
  const found = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(js|cjs|mjs)$/.test(entry.name)) continue;
      const rel = path.relative(ROOT, full).split(path.sep).join('/');
      if (rel === 'test/platform-branch-freeze.test.mjs') continue; // 门禁本体自排除
      const text = fs.readFileSync(full, 'utf8');
      if (text.includes('process.platform')) found.add(rel);
    }
  };
  for (const r of SCAN_ROOTS) walk(path.join(ROOT, r));
  return found;
}

describe('process.platform 分支冻结门（BLOCK-104 P4）', () => {
  it('基线之外不得新增 process.platform 散落分支', () => {
    const found = scan();
    const unknown = [...found].filter((f) => !BASELINE.has(f)).sort();
    assert.deepEqual(
      unknown,
      [],
      '以下新文件引入 process.platform——平台分支应收敛到 src/platform-compat.js，' +
        '或确认必要后将文件登记进本测试 BASELINE（登记即留痕）: ' + unknown.join(', ')
    );
    // 基线存活校验：登记文件被删除/改名后同步收缩基线，防止名单僵化。
    const missing = [...BASELINE].filter((f) => !found.has(f)).sort();
    if (missing.length > 0) {
      console.log(`[platform-freeze] 基线中 {missing.length} 个文件已无 process.platform（建议收缩基线）: ${missing.join(', ')}`);
    }
  });
});
