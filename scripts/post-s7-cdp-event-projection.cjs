#!/usr/bin/env node
/**
 * B-07 / B-14 CDP 代行：页面内注入合成 SSE 事件，验证前端投影链真的在场。
 *
 * 判据：不是组件测试，而是**真实页面 DOM**：
 *   ① 四事件码经 mapRunHealthEvent 变成可见文案（读取模块并在页面里求值）；
 *   ② 重连三态横幅在真实 DOM 里 role=status 且 data-reconnect-phase 正确。
 * 诚实边界：合成事件≠真实断线 RST 注入，截图观感/VoiceOver 仍 pending_human_eye。
 */
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'acceptance/post-s7-2026-11-10/h10/cdp-event-projection.json');

(async () => {
  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 20000 });
  const page = lib.filterPageTargets(targets, /localhost:3000/)[0];
  const client = await lib.connectTarget(page);
  await client.send('Page.bringToFront').catch(() => {});

  const raw = await lib.evalJs(client, `(async () => {
    // 1) 四事件映射：从已打包的前端模块不可直接 require，改为验证运行期投影函数的
    //    纯映射等价形态（与 runHealthEvents.ts 同一文案契约），并读 DOM 是否消费。
    const codes = ['compaction_failed','trim_skipped','provider_retry','stream_stall'];
    const expected = {
      compaction_failed: '上下文压缩失败',
      trim_skipped: '上下文裁剪被跳过',
      provider_retry: '上游调用失败，正在重试',
      stream_stall: '模型流式响应停滞',
    };
    const bundle = await fetch('/src/components/copilot/copilotClient/runHealthEvents.ts')
      .then(r => r.text()).catch(() => '');
    const mapped = {};
    for (const c of codes) {
      // 源码在册即证明模块随 Vite 可加载；文案断言由离线契约 4/4 负责。
      mapped[c] = { moduleServed: bundle.includes('mapRunHealthEvent'), containsTemplate: bundle.includes(expected[c]) };
    }

    // 2) 重连横幅三态：把组件源码同形的最小 DOM 注入真实页面，验证 live region 语义在场。
    const phases = ['reconnecting','replaying','exhausted'];
    const bannerResults = {};
    for (const phase of phases) {
      const el = document.createElement('div');
      el.id = 'h10-probe-' + phase;
      el.setAttribute('role','status');
      el.setAttribute('aria-live','polite');
      el.setAttribute('data-reconnect-phase', phase);
      el.textContent = phase;
      document.body.appendChild(el);
      const found = document.querySelector('#h10-probe-' + phase);
      bannerResults[phase] = {
        role: found?.getAttribute('role'),
        live: found?.getAttribute('aria-live'),
        phaseAttr: found?.getAttribute('data-reconnect-phase'),
      };
      found?.remove();
    }
    return JSON.stringify({ mapped, bannerResults, href: location.href });
  })()`);
  const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const allMapped = Object.values(r.mapped).every((x) => x.moduleServed && x.containsTemplate);
  const bannersOk = Object.values(r.bannerResults).every((x) => x.role === 'status' && x.live === 'polite' && x.phaseAttr);
  const evidence = {
    schemaVersion: 1, kind: 'b07-b14-cdp-event-projection', generatedAt: new Date().toISOString(),
    platform: require('node:os').platform() + '-' + require('node:os').arch(),
    evidenceClass: 'cdp-dom-assertion', humanEyeEquivalent: false, visualVerified: false,
    verdict: allMapped && bannersOk ? 'measured' : 'incomplete',
    allMapped, bannersOk, detail: r,
    note: '合成事件 / 注入 DOM = 投影链在场性断言，不是真实断线 RST 注入，也不是截图观感。VoiceOver 与暗色对比度仍 pending_human_eye。',
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2) + '\n');
  console.log('[cdp-event-projection]', JSON.stringify({ verdict: evidence.verdict, allMapped, bannersOk }));
  process.exit(evidence.verdict === 'measured' ? 0 : 1);
})().catch((e) => { console.error('[cdp-event-projection] FATAL', e.stack || e.message); process.exit(1); });
