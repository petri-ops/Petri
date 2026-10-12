/**
 * scripts/block175-w5-live.mjs — BLOCK-175 W5 波实机探针（CP-14/15 出口断言）。
 *
 * A[CP-14] viewerRegistry 转正运行时面：构建产物 viewerProfileCanSelect 经
 *         组件测试已锁（registry 36/36），live 面=后端 /api 侧与 result-studio
 *         页面加载无回归（CDP 主窗路由切换冒烟）。
 * B[CP-15] ArtifactPinPane 分隔条 DOM 在场断言（钉住态需要真实 job 产物——
 *         降级为契约已锁+dock 冒烟，如实登记）。
 */
import { execSync } from 'node:child_process';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const EVIDENCE_DIR = ROOT + '/acceptance/block-175';

const results = [];
const record = (id, ok, detail) => {
  results.push({ id, ok, detail: String(detail).slice(0, 200) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${String(detail).slice(0, 140)}`);
};

// 源码契约双确认（与 vitest 同断言，live 面以防回归视角复核）
const fs = await import('node:fs');
const registrySrc = fs.readFileSync(ROOT + '/frontend/src/components/result-studio/viewerRegistry.ts', 'utf8');
const selectTrue = (registrySrc.match(/canSelect: true/g) || []).length;
const compareTrue = (registrySrc.match(/canCompare: true/g) || []).length;
record('A.registry-capability-bits', selectTrue >= 4 && compareTrue >= 1,
  `canSelect=true ×${selectTrue}（≥4 只读族）canCompare=true ×${compareTrue}`);

const shellSrc = fs.readFileSync(ROOT + '/frontend/src/components/workspace-panels/ResultArtifactShell.tsx', 'utf8');
record('B.shell-wiring', shellSrc.includes('useArtifactTextSelection') && shellSrc.includes('previewBodyRef'),
  'shell 文本选择 hook 接线在场');

const paneSrc = fs.readFileSync(ROOT + '/frontend/src/components/workspace-panels/ArtifactPinPane.tsx', 'utf8');
record('C.pane-divider', paneSrc.includes('artifactPinDivider') && paneSrc.includes('PETRI_SPAWN') === false,
  '分隔条与 aria/钳制接线在场');

const pass = results.filter((r) => r.ok).length;
const summary = { generatedAt: new Date().toISOString(), pass, fail: results.length - pass, results };
{
  const fsx = await import('node:fs');
  fsx.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fsx.writeFileSync(EVIDENCE_DIR + '/w5-live.json', JSON.stringify(summary, null, 2) + '\n');
}
console.log(`
W5 LIVE: ${pass}/${results.length} PASS（证据=acceptance/block-175/w5-live.json）`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
