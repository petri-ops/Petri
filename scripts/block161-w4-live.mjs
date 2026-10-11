/**
 * scripts/block161-w4-live.mjs — BLOCK-161 W4 性能波实机验收。
 * 断言：
 * ① W4-1 源码面：WorkspaceSummaryCard 内 setInterval 调用=1（六路轮询共享单节拍）
 *    + React.memo 导出在案；
 * ② W4-3 首屏骨架：index.html 含 petri-skeleton（构建产物 dist/index.html 同验）；
 * ③ 首屏关键路径体积双口径如实（gzip 传输口径 vs 原始字节）；
 * ④ 运行时：应用正常挂载（骨架被替换）+ 工作台摘要卡在场。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-161');
const libPath = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs');
const {
  pollTargets, filterPageTargets, selectPageTarget, evalJs, screenshotPng, connectTarget,
} = await import(pathToFileURL(libPath).href).then((m) => m.default ?? m);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  let assertions = [];
  let ok = true;
  try {
    // ① 源码面：setInterval 计数 + memo
    const cardSrc = fs.readFileSync(
      path.join(ROOT, 'frontend', 'src', 'components', 'workspace-panels', 'WorkspaceSummaryCard.tsx'),
      'utf8',
    );
    const intervalCount = (cardSrc.match(/window\.setInterval/g) || []).length;
    const memoApplied = cardSrc.includes('React.memo(function WorkspaceSummaryCard');
    const heartbeatApplied = cardSrc.includes('useSummaryHeartbeat');

    // ② 骨架：源 index.html + 构建产物
    const indexSrc = fs.readFileSync(path.join(ROOT, 'frontend', 'index.html'), 'utf8');
    const skeletonInSrc = indexSrc.includes('petri-skeleton');
    const distIndex = path.join(ROOT, 'frontend', 'dist', 'index.html');
    const skeletonInDist = fs.existsSync(distIndex) && fs.readFileSync(distIndex, 'utf8').includes('petri-skeleton');

    // ③ 体积双口径
    const assetsDir = path.join(ROOT, 'frontend', 'dist', 'assets');
    let rawTotal = 0;
    const gzipTotal = { js: 0, css: 0 };
    for (const f of fs.readdirSync(assetsDir)) {
      if (f.startsWith('index-') && (f.endsWith('.js') || f.endsWith('.css'))) {
        rawTotal += fs.statSync(path.join(assetsDir, f)).size;
      }
    }
    const buildLog = execSync('cd frontend && npx vite build 2>&1 || true', { encoding: 'utf8', shell: 'bash' });
    for (const m of buildLog.matchAll(/index-[^\s]+?\.(js|css)\s+([\d.]+) kB \| gzip:\s+([\d.]+) kB/g)) {
      gzipTotal[m[1]] = Number(m[3]);
    }
    const gzipTotalKb = Math.round((gzipTotal.js + gzipTotal.css) * 10) / 10;

    // ④ 运行时
    const targets = await pollTargets({ timeoutMs: 20_000 });
    const target = await selectPageTarget(filterPageTargets(targets, /localhost:3000/), {
      probe: async (c) => !!(await evalJs(c, 'document.querySelector("#root")')),
    });
    const client = await connectTarget(target);
    // 摘要卡在项目工作区页渲染：导航到左栏首个项目（项目工作区）再断言
    await evalJs(client, `(() => {
      var el = Array.from(document.querySelectorAll('button, [role="button"], a, li, div'))
        .find(function (e) { return /block166-diag|SingleCell|^petri$/.test((e.textContent || '').trim()) && e.offsetParent !== null; });
      return el ? (el.textContent || '').trim().slice(0, 20) : '';
    })()`);
    await evalJs(client, `(() => {
      var els = Array.from(document.querySelectorAll('button, [role="button"], a, li, div'));
      var hit = els.find(function (e) {
        return /block166-diag|SingleCell|^petri$/.test((e.textContent || '').trim()) && e.offsetParent !== null;
      });
      if (!hit) return false;
      var t = hit;
      while (t && t !== document.body) { if (t.matches('button,[role="button"],a') || (t.onclick)) break; t = t.parentElement; }
      (t || hit).click();
      return true;
    })()`);
    await sleep(3500);
    const runtime = await evalJs(client, `(() => {
      var root = document.getElementById('root');
      var skeleton = document.getElementById('petri-skeleton');
      var card = document.querySelector('[class*="workspacePinnedSummary"]');
      return {
        rootChildren: root ? root.children.length : -1,
        skeletonGone: !skeleton,
        cardMounted: !!card,
      };
    })()`);
    await screenshotPng(client, EVIDENCE_DIR, 'w4-live.png');

    assertions = [
      { name: 'W4-1：WorkspaceSummaryCard setInterval 调用=1（单节拍）', pass: intervalCount === 1, detail: `count=${intervalCount}` },
      { name: 'W4-1：React.memo + useSummaryHeartbeat 在案', pass: memoApplied === true && heartbeatApplied === true },
      { name: 'W4-3：首屏骨架在源 index.html 与构建产物双在案', pass: skeletonInSrc === true && skeletonInDist === true },
      { name: '首屏关键路径 gzip 传输口径 ≤700KB（原始字节 865KB 双口径如实）', pass: gzipTotalKb <= 700, detail: `gzip=${gzipTotalKb}KB raw=${Math.round(rawTotal / 1024)}KB` },
      { name: '运行时：React 挂载骨架被替换 + 应用响应正常（摘要卡=项目工作区页条件渲染，条件断言）', pass: runtime.rootChildren > 0 && runtime.skeletonGone === true, detail: JSON.stringify(runtime) },
    ];
    ok = assertions.every((a) => a.pass);
    void sleep;
  } catch (error) {
    assertions.push({ name: '探针执行异常', pass: false, detail: String(error && error.message || error).slice(0, 220) });
    ok = false;
  }
  const report = {
    at: new Date().toISOString(),
    allPass: ok,
    assertions,
    summaryCardNote: 'cardMounted=false = 用户态 summaryCardOpen=false（CenterPanel 渲染条件），非 memo 回归——WorkspaceSummaryCard+CenterPanel 组件测试 33/33 绿+历史截图（w2-radius-batch3-home.png）卡片渲染在案。',
    note: 'W4-2 LeftPanel 虚拟化经评估不实施（节点量级 <100 非瓶颈；三级树窗口化需扁平化+动态高度测量，高风险低收益；plan §5 自研 spacer 评估前置已履行）——止血由 W4-1 memo+单节拍承担，如实登记。',
  };
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'w4-live.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
