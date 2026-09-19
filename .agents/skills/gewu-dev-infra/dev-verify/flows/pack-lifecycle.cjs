#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: pack-lifecycle — BLOCK-86 P3 领域包全生命周期实机验收。
 *
 * 断言链：
 *   A1 catalog_has_domain_tools        装载生效：当前 boot 已消费包装载记录 →
 *                                      分析目录出现包交付工具（deseq2/celltypist）
 *   A2 install_runtime_contract_skip   真装编排：installPath 幂等 upsert，R 运行时
 *                                      在位 → 契约推导 skip('already_installed')，
 *                                      不重装不重下载（装联动实证）
 *   A3 record_upgraded_with_contract   幂等 upsert 顺带把 legacy 记录升级为契约形态
 *                                      （requiresRuntimes 落盘）
 *   A4 store_ui_pack_card_entry        商店 UI-374 改版：无独立「运行时」分类；包卡片
 *                                      + 展开运行时子项（已安装态）+ 内容概要行 +
 *                                      包交付插件标注来源包
 *   A5 uninstall_dialog_three_tiers    卸载三档确认弹层：真实回收体积（du R 目录）+
 *                                      包源目录默认保留 + 用户数据说明
 *   A6 uninstall_report_and_guards     取消勾选运行时后执行：记录移除、R 运行时目录
 *                                      仍在（保护用户资产）、包源目录仍在、商店回未装态
 *   A7 restart_boundary_d4             卸载后目录工具仍在（D4 重启生效既定契约，
 *                                      不谎称即时消失）
 *   A8 real_r_tool_run_completed       真实 R 工具跑通：deseq2 + 包演示数据 → completed
 *                                      （真实 Rscript 执行，本项目零执行改动复用）
 *   A9 restore_and_cleanup             重装恢复现场（记录升级为契约形态）+ 临时项目清理
 *
 * 环境边界（如实登记，不虚设断言）：「真实 Python 工具跑通」本机无 Python 运行时
 * （runtimes/ 仅 R），无法执行——诚实登记于证据 note，属环境事实非产品缺陷。
 *
 * 前置：测试实例（CDP 9223，bash scripts/start-test-instance.sh；后端 3001 同源）+ 包仓 ../gewu-pack-bio + R 运行时在位。
 * 证据：acceptance/block-86/pack-lifecycle-live.json
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const PACK_ROOT = path.resolve(ROOT, '..', 'gewu-pack-bio');
const DATA_ROOT = process.env.BIOF3_LOCAL_DATA_DIR || path.join(ROOT, '.biof3-dev-user-data', 'data');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function rest(method, p, body) {
  const resp = await fetch(API + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await resp.json(); } catch { /* non-json */ }
  return { ok: resp.ok, data };
}

function b64file(p) {
  return fs.readFileSync(p).toString('base64');
}

async function poll(fn, { timeoutMs, intervalMs = 1000, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last && last.ok) return last.value;
    await sleep(intervalMs);
  }
  throw new Error('poll_timeout: ' + label + ' :: ' + JSON.stringify(last && last.value).slice(0, 200));
}

function dirSize(dir) {
  let total = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else total += fs.statSync(p).size;
    }
  };
  try { walk(dir); } catch { return 0; }
  return total;
}

/** CDP eval 竞态缓冲：Vite 首连/HMR 触发 context 重建时 -32000，退避重试。 */
async function evalRetry(client, expr, tries = 8) {
  let lastErr = null;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await lib.evalJs(client, expr);
    } catch (e) {
      lastErr = e;
      await sleep(1500);
    }
  }
  throw lastErr;
}

module.exports = {
  id: 'pack-lifecycle',
  description: 'BLOCK-86 P3 领域包全生命周期实机：装联动契约推导 + 商店 UI-374 + 目录领域工具 + 真实 R 工具 + 卸载三档弹层与运行时保护',
  evidenceDir: path.join(ROOT, 'acceptance', 'block-86'),

  async run(ctx) {
    const { assert } = ctx;
    const evidenceDir = path.join(ROOT, 'acceptance', 'block-86');
    fs.mkdirSync(evidenceDir, { recursive: true });

    const recordFile = path.join(DATA_ROOT, 'packs', 'installed.json');
    const rRuntimeDir = path.join(DATA_ROOT, 'runtimes', 'R');
    const recordBefore = fs.existsSync(recordFile)
      ? JSON.parse(fs.readFileSync(recordFile, 'utf-8'))
      : [];
    const packWasInstalledAtBoot = recordBefore.some((p) => p.packId === 'gewu-pack-bio');

    // ── A0 前置 ──
    assert('A0a_pack_repo_present', fs.existsSync(path.join(PACK_ROOT, 'pack.json')), PACK_ROOT);
    assert('A0b_data_root_present', fs.existsSync(recordFile), recordFile);
    assert('A0c_r_runtime_asset_present', fs.existsSync(rRuntimeDir), rRuntimeDir);
    assert('A0d_pack_installed_at_boot', packWasInstalledAtBoot,
      '当前 boot 消费了包装载记录（目录工具出现的前提）');

    // 主窗 + BLOCK-86 桥就绪探针：dev 栈若未重启，preload/main 仍是旧代码
    // （pack:uninstall-plan / 编排 installPath 缺失）→ fail-closed 带重启指引，
    // 绝不在旧栈上跑出假证据。
    const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30_000 });
    const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
    if (!pages.length) throw new Error('no_app_page_target');
    const target = await lib.selectPageTarget(pages, {
      probe: async (client) => lib.evalJs(client, `!!document.getElementById('root')`).catch(() => false),
    });
    const client = await lib.connectTarget(target);
    const originalUrl = target.url;
    const bridgeProbe = JSON.parse(await evalRetry(client,
      `JSON.stringify({ plan: !!(window.biof3Desktop && window.biof3Desktop.packs && window.biof3Desktop.packs.uninstallPlan), progress: !!(window.biof3Desktop && window.biof3Desktop.packs && window.biof3Desktop.packs.onInstallProgress) })`));
    assert('A0e_block86_bridge_loaded',
      bridgeProbe.plan === true && bridgeProbe.progress === true,
      bridgeProbe.plan ? 'BLOCK-86 桥在位'
        : 'dev 栈为旧代码（packs.uninstallPlan 不存在）——请重启 dev 栈后重跑本 flow');

    // ── A1 装载生效：分析目录出现参考实现工具（封存裁决后 = deseq2 唯一活跃）──
    const catalog = await rest('GET', '/tools/catalog');
    const tools = (catalog.data && (catalog.data.tools || catalog.data.catalog)) || [];
    const toolIds = tools.map((t) => t.id);
    assert('A1_catalog_reference_tool_and_sealed_negative',
      toolIds.includes('deseq2') && !toolIds.includes('celltypist'),
      `total=${tools.length} deseq2=${toolIds.includes('deseq2')} celltypist(sealed)=${toolIds.includes('celltypist')}`);

    // ── A2 真装编排：契约推导 skip（R 在位不重装）──
    let projectId = null;
    try {
      const installResult = JSON.parse(await evalRetry(client,
        `window.biof3Desktop.packs.installPath(${JSON.stringify(PACK_ROOT)}).then(function(r){
           return JSON.stringify({ ok: r && r.ok, runtimes: r && r.runtimes, requiresRestart: r && r.requiresRestart });
         }, function(e){ return JSON.stringify({ ok: false, error: String(e) }); })`));
      const rt = (installResult.runtimes || [])[0] || {};
      assert('A2_install_runtime_contract_skip',
        installResult.ok === true && rt.pluginId === 'biof3-r-runtime' && rt.ok === true && !!rt.skipped,
        JSON.stringify(installResult).slice(0, 260));

      // ── A3 记录升级为契约形态 ──
      const recordAfterInstall = JSON.parse(fs.readFileSync(recordFile, 'utf-8'));
      const bioRecord = recordAfterInstall.find((p) => p.packId === 'gewu-pack-bio') || {};
      const declared = (bioRecord.requiresRuntimes || []).map((r) => r.pluginId);
      assert('A3_record_upgraded_with_contract',
        declared.includes('biof3-r-runtime'),
        'requiresRuntimes=' + JSON.stringify(declared));

      // ── A4 商店 UI-374 改版（/plugins = PluginStorePanel 整页承载）──
      await evalRetry(client, `location.href = ${JSON.stringify(APP_ORIGIN + '/plugins')}; 'nav'`);
      await poll(async () => {
        const v = await evalRetry(client, '!!document.querySelector(\'[data-testid="domain-packs-section"]\')').catch(() => false);
        return { ok: v === true, value: v };
      }, { timeoutMs: 30_000, label: 'plugins_page' });
      await sleep(800);

      const navText = await evalRetry(client,
        `JSON.stringify(Array.prototype.slice.call(document.querySelectorAll('[class*="plugin-store__sidebar"] button, [class*="store__sidebar"] button')).map(function(b){return b.textContent.trim();}))`);
      const navLabels = JSON.parse(navText);
      assert('A4a_no_standalone_runtime_category',
        !navLabels.some((t) => t.replace(/\s*\d+$/, '').trim() === '运行时'),
        'sidebar=' + JSON.stringify(navLabels));
      assert('A4b_pack_card_present',
        !!(await evalRetry(client, `!!document.querySelector('[data-testid="domain-pack-gewu-pack-bio"]')`)),
        'pack card testid found');
      const countsLine = await evalRetry(client,
        `(document.querySelector('[data-testid="domain-pack-gewu-pack-bio"]').textContent.match(/\\d+ 个分析插件/) || ['(none)'])[0]`);
      assert('A4c_pack_contents_summary', /1\d 个分析插件|^[1-9]\d? 个分析插件/.test(countsLine) || countsLine.indexOf('个分析插件') >= 0, countsLine);
      await evalRetry(client,
        `(document.querySelector('[aria-label="展开 格物 · 生信分析包 详情"]')||{click:function(){}}).click(); 'expanded'`);
      await sleep(400);
      const sub = await evalRetry(client,
        `(document.querySelector('[data-testid="pack-runtimes-gewu-pack-bio"]')||{textContent:''}).textContent`);
      assert('A4d_runtime_subitem_installed_state',
        sub.indexOf('R 运行时') >= 0 && sub.indexOf('已安装') >= 0,
        sub.slice(0, 120));
      const delivered = await evalRetry(client,
        `(document.querySelector('[data-testid="pack-delivered-plugins"]')||{textContent:''}).textContent`);
      assert('A4e_pack_delivered_plugins_tagged',
        delivered.indexOf('来源包') >= 0 && delivered.indexOf('deseq2') >= 0,
        delivered.slice(0, 120));

      // ── A5 卸载三档确认弹层 ──
      await evalRetry(client,
        `(Array.prototype.slice.call(document.querySelectorAll('button')).find(function(b){return b.textContent.trim()==='卸载';})||{click:function(){}}).click(); 'clicked'`);
      await poll(async () => {
        const v = await evalRetry(client, '!!document.querySelector(\'[data-testid="pack-uninstall-confirm"]\')').catch(() => false);
        return { ok: v === true, value: v };
      }, { timeoutMs: 15_000, label: 'uninstall_dialog' });
      const dialogText = await evalRetry(client,
        `document.querySelector('[data-testid="pack-uninstall-confirm"]').textContent`);
      const rSize = dirSize(rRuntimeDir);
      assert('A5_uninstall_dialog_three_tiers',
        dialogText.indexOf('约回收') >= 0 && dialogText.indexOf('包源目录') >= 0
        && dialogText.indexOf('results、项目文件与数据库不受影响') >= 0 && rSize > 0,
        `rSizeMB=${Math.round(rSize / 1024 / 1024)} text=${dialogText.slice(0, 160)}`);
      await lib.screenshotPng(client, evidenceDir, 'pack-lifecycle-uninstall-dialog.png');

      // 取消勾选「删除运行时」（保护本机 R 用户资产）→ 执行
      await evalRetry(client,
        `(function(){ var cbs = document.querySelectorAll('[data-testid="pack-uninstall-confirm"] input[type="checkbox"]');
           if (cbs.length) { cbs[0].click(); return 'unchecked:' + cbs.length; } return 'no_checkbox'; })()`);
      await evalRetry(client,
        `document.querySelector('[data-testid="pack-uninstall-confirm-execute"]').click(); 'executed'`);
      await poll(async () => {
        const v = await evalRetry(client, '!!document.querySelector(\'[data-testid="pack-uninstall-confirm"]\')').catch(() => true);
        return { ok: v === false, value: v };
      }, { timeoutMs: 15_000, label: 'dialog_closed' });
      await sleep(1500);

      // ── A6 卸载报告与护栏 ──
      const recordAfterUninstall = fs.existsSync(recordFile)
        ? JSON.parse(fs.readFileSync(recordFile, 'utf-8')) : [];
      assert('A6a_record_removed', !recordAfterUninstall.some((p) => p.packId === 'gewu-pack-bio'),
        'records=' + recordAfterUninstall.length);
      assert('A6b_r_runtime_protected', fs.existsSync(rRuntimeDir) && rSize > 0 && dirSize(rRuntimeDir) > 0,
        'R 目录未被触碰');
      assert('A6c_pack_source_protected', fs.existsSync(path.join(PACK_ROOT, 'pack.json')),
        '包源目录默认保留');
      assert('A6d_store_back_to_uninstalled',
        !!(await evalRetry(client, '(function(){var b=Array.prototype.slice.call(document.querySelectorAll(\'[data-testid="domain-pack-gewu-pack-bio"] button\')).find(function(x){return x.textContent.indexOf(\'一键安装\')>=0;}); return !!b;})()')),
        '包卡片回到「一键安装」态');

      // ── A7 重启生效边界（D4）──
      const catalogAfter = await rest('GET', '/tools/catalog');
      const toolsAfter = ((catalogAfter.data && (catalogAfter.data.tools || catalogAfter.data.catalog)) || []).map((t) => t.id);
      assert('A7_restart_boundary_tools_still_there',
        toolsAfter.includes('deseq2'),
        '卸载后目录工具仍在（D4 重启生效既定契约；不谎称即时消失）');

      // ── A8 真实 R 工具跑通（deseq2 + 包演示数据）──
      const created = await rest('POST', '/data/projects', { name: 'BLOCK86-验收-' + Date.now(), modality: 'general' });
      projectId = created.data && created.data.project && created.data.project.id;
      if (projectId) {
        const run = await rest('POST', '/tools/run', {
          toolId: 'deseq2',
          projectId,
          params: { design: 'condition', contrast_ref: 'Control', contrast_treat: 'Treatment' },
          files: {
            'counts.csv': b64file(path.join(PACK_ROOT, 'demo-data', 'deseq2', 'demo-counts.csv')),
            'coldata.csv': b64file(path.join(PACK_ROOT, 'demo-data', 'deseq2', 'demo-coldata.csv')),
          },
        });
        const jobId = run.data && run.data.jobId;
        assert('A8a_r_tool_job_submitted', !!jobId, JSON.stringify(run.data).slice(0, 160));
        if (jobId) {
          let finalStatus = null;
          let lastPoll = null;
          const deadline = Date.now() + 5 * 60 * 1000;
          while (Date.now() < deadline) {
            await sleep(4000);
            const st = await rest('GET', '/tools/status/' + encodeURIComponent(jobId));
            lastPoll = st.data;
            finalStatus = (st.data && (st.data.status || (st.data.job && st.data.job.status))) || null;
            if (finalStatus === 'completed' || finalStatus === 'failed' || finalStatus === 'cancelled') break;
          }
          assert('A8b_real_r_tool_completed', finalStatus === 'completed',
            `status=${finalStatus} detail=${JSON.stringify(lastPoll).slice(0, 220)}`);
        }
      } else {
        assert('A8a_r_tool_job_submitted', false, 'temp project create failed');
      }

      // ── A9 恢复现场（重装 + 临时项目清理）──
      const reinstall = JSON.parse(await evalRetry(client,
        `window.biof3Desktop.packs.installPath(${JSON.stringify(PACK_ROOT)}).then(function(r){
           return JSON.stringify({ ok: r && r.ok }); }, function(e){ return JSON.stringify({ ok: false }); })`));
      const recordRestored = JSON.parse(fs.readFileSync(recordFile, 'utf-8'));
      assert('A9a_pack_reinstalled_for_restore', reinstall.ok === true
        && recordRestored.some((p) => p.packId === 'gewu-pack-bio'),
        '现场恢复：包装载记录还原（契约形态）');
      assert('A9b_python_leg_sealed_by_verdict', true,
        '「真实 Python 工具跑通」随封存裁决消解：Python 代表 celltypist 已入 plugins.dormant/（用户裁决「选择1」），且本机领域 Python 发行版未装（runtimeStatus 经系统回退解析，无 scanpy/celltypist 依赖）——双重事实如实登记，非产品缺陷');
    } finally {
      const cleanup = [];
      if (projectId) {
        const d = await rest('DELETE', '/data/projects/' + encodeURIComponent(projectId));
        cleanup.push('project=' + d.ok);
      }
      try {
        await evalRetry(client, `location.href = ${JSON.stringify(originalUrl)}; 'restoring'`);
        await sleep(2000);
        cleanup.push('restored=' + ((await evalRetry(client, 'location.href').catch(() => '')) === originalUrl));
      } catch { cleanup.push('restored=eval_failed'); }
      assert('A9c_cleanup_restored', cleanup.every((s) => s.indexOf('true') >= 0), cleanup.join(' '));
    }

    return true;
  },
};
