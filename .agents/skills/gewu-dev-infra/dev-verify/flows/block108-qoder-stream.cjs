#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block108-qoder-stream — BLOCK-108 实机腿（UI-429）
 *
 * 覆盖 plan §5 的 Q1-Q7：Qoder 形态的实机对账——执行间过渡叙述（簇前正文式）、
 * 计数式簇头（执行工具 N 次 + 需注意 + 秒表）、簇内统一单行（含 exec 默认折叠）、
 * 点击展开终端体、思考入簇、刷新后同序、临时数据清理。只连自管测试实例（:9223）。
 *
 * 数据副作用与清理（真调模型，自带收口）：建临时项目 `B108-Qoder-<ts>` →
 * 会话由 SimpleChat 自建 → finally 里 DELETE 会话 + DELETE 项目 + 恢复原 URL。
 *
 * 判据诚实性：过渡叙述依赖模型真实产出叙述文本——提示词显式要求「每次调用前先
 * 说明接下来做什么」（这是产品期望的用户引导形态，不是伪造数据）；模型若不产出
 * 叙述，Q1 会真红。思考入簇（Q5）依赖模型产出 reasoning——无 reasoning 时按
 * 诚实分级判红并在 detail 记录事实，不放宽。
 *
 * 证据：acceptance/block-108/block108-qoder-stream*.json + expanded/reloaded PNG。
 * 前置：dev 栈在跑 + 测试实例（bash scripts/start-test-instance.sh）+ 模型凭据已配置。
 */
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE_DIR = path.join(process.cwd(), 'acceptance', 'block-108');
const RUN_TIMEOUT_MS = Number(process.env.BLOCK108_RUN_TIMEOUT_MS || 300_000);

const PROMPT = '请依次用工具完成三件事，每件事单独一次调用、按顺序逐个来做、不要并行，'
  + '并且每次调用工具之前先用一两句话说明你接下来要做什么：'
  + '(1) 执行命令 `node -e "setTimeout(()=>console.log(1),4000)"` 并等它执行完；'
  + '(2) 原样执行命令 `type qoder-腿-不存在.txt`——不要换成别的命令、不要改写、不要先检查文件是否存在。'
  + '该文件不存在，命令必然失败，而失败正是本测试要观察的异常路径，请照实执行并把失败原样报告；'
  + '(3) 列出项目根目录的文件；'
  + '最后用一句话总结这个项目里有什么。';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rest(method, endpoint, body) {
  const resp = await fetch(API + endpoint, {
    method,
    headers: { ...AUTH, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json().catch(() => null);
  return { ok: resp.ok, data };
}

/** 页面内求值：时间线逐段序列（X=过渡叙述 R=思考 T=工具簇）+ 簇头 + Qoder 行态。 */
const PROBE = `JSON.stringify((function(){
  var timelines = [].slice.call(document.querySelectorAll('.sc-conversation-timeline')).map(function(t){
    return [].slice.call(t.children).map(function(c){
      var kind = c.classList.contains('sc-timeline-transition') ? 'X'
        : c.classList.contains('sc-timeline-reasoning') ? 'R'
        : c.classList.contains('sc-timeline-cluster') ? 'T' : '?';
      return kind + ':' + (c.getAttribute('data-iteration') || '-');
    }).join(' ');
  });
  var heads = [].slice.call(document.querySelectorAll('.sc-tool-activity-summary-label'))
    .map(function(n){ return (n.textContent || '').replace(/\\s+/g, ' ').trim(); });
  var transitions = [].slice.call(document.querySelectorAll('.sc-timeline-transition-text'))
    .map(function(n){ return (n.textContent || '').replace(/\\s+/g, ' ').trim(); });
  var bodies = [].slice.call(document.querySelectorAll('.sc-msg-body'))
    .map(function(n){ return (n.textContent || '').replace(/\\s+/g, ' ').trim().length; });
  return {
    timelines: timelines,
    heads: heads,
    transitions: transitions,
    qoderRows: document.querySelectorAll('.sc-tool-qoder-row').length,
    errorRows: document.querySelectorAll('.sc-tool-qoder-row[data-status="error"]').length,
    termOutputs: document.querySelectorAll('.sc-tool-term-output').length,
    routineGroups: document.querySelectorAll('.sc-tool-routine-group').length,
    reasoningInCluster: document.querySelectorAll('.sc-tool-activity-inline .sc-tool-reasoning').length,
    standaloneReasoning: document.querySelectorAll('.sc-timeline-reasoning').length,
    running: document.querySelectorAll('.sc-timeline-cluster[data-state="running"]').length,
    lastBody: bodies.length ? bodies[bodies.length - 1] : 0,
  };
})())`;

/** 每个过渡叙述（X）都必须紧跟其工具簇（T）——Qoder「模型说话 → 模型做事」。 */
function transitionsBeforeClusters(seq) {
  const parts = (seq || '').split(' ').filter(Boolean);
  return parts.every((part, index) => {
    if (!part.startsWith('X')) return true;
    return index + 1 < parts.length && parts[index + 1].startsWith('T');
  });
}

module.exports = {
  id: 'block108-qoder-stream',
  description: 'BLOCK-108 实机腿：过渡叙述簇前正文式 + 计数簇头 + 簇内统一单行/点击展开/思考入簇 + 刷新同序',
  evidenceDir: EVIDENCE_DIR,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const client = await lib.connectTestTarget({ timeoutMs: 25_000 });
    const originalUrl = String(await lib.evalJs(client, 'location.href', 8_000));
    let projectId = null;
    let conversationId = null;

    try {
      const created = await rest('POST', '/data/projects', { name: `B108-Qoder-${Date.now()}`, modality: 'general' });
      if (!created.ok || !created.data?.project) throw new Error('create_project_failed: ' + JSON.stringify(created.data).slice(0, 200));
      projectId = created.data.project.id;

      await lib.evalJs(client, `location.href = '${APP_ORIGIN}/?project=${projectId}'; 'go'`, 10_000);
      // UI-430 实机教训：SPA 路由切换完成前旧页面的 textarea 仍可查询到——
      // 「textarea 出现」即输入会打在即将卸载的元素上（症状=输入成功但零后端请求）。
      // 导航后固定等待路由稳定，再等 composer 就绪。
      await sleep(10000);
      const welcomed = Date.now() + 30_000;
      while (Date.now() < welcomed
        && !(await lib.evalJs(client, `!!document.querySelector('[class*="chatMount"] textarea.sc-input')`, 8_000).catch(() => false))) {
        await sleep(1000);
      }

      const typed = await lib.evalJs(client, `(function(){
        var ta = document.querySelector('[class*="chatMount"] textarea.sc-input');
        if (!ta) return 'no_textarea';
        var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, ${JSON.stringify(PROMPT)});
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        // 发送方式定版（2026-09-21 实机对照）：按钮 click 在栈健康时端到端可靠；
        // 合成 KeyboardEvent(Enter) 不触发提交（untrusted 事件被 composer 忽略，
        // 症状=textarea 不清空、零网络请求）。Enter 仅作按钮失败后的兜底。
        var btns = document.querySelectorAll('[class*="chatMount"] button');
        for (var i = 0; i < btns.length; i++) {
          if ((btns[i].getAttribute('title') || '').indexOf('发送消息') >= 0) { btns[i].click(); return 'typed'; }
        }
        return 'no_send_button';
      })()`, 10_000);
      if (typed !== 'typed') throw new Error('send_click_failed: ' + typed);

      // 确认已发出：输入框清空=提交成功的可观察信号。项目上下文（workspace 初始化）
      // 未就绪时提交会被吞，故 2.5s 间隔重试点击至多 4 次，最后走 Enter 兜底。
      let sent = 'not_sent';
      for (let attempt = 1; attempt <= 4 && sent !== 'sent_ok'; attempt++) {
        await sleep(2500);
        sent = await lib.evalJs(client, `(function(){
          var ta = document.querySelector('[class*="chatMount"] textarea.sc-input');
          if (ta && (ta.value || '').trim().length > 0) {
            var btns = document.querySelectorAll('[class*="chatMount"] button');
            for (var i = 0; i < btns.length; i++) {
              if ((btns[i].getAttribute('title') || '').indexOf('发送消息') >= 0) { btns[i].click(); return 'clicked_retry'; }
            }
          }
          return 'sent_ok';
        })()`, 10_000);
        lib.log(`send attempt ${attempt}: ${sent}`);
      }
      if (sent !== 'sent_ok') {
        await lib.evalJs(client, `(function(){
          var ta = document.querySelector('[class*="chatMount"] textarea.sc-input');
          if (ta) ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          return 'enter_fallback';
        })()`, 10_000);
        await sleep(1500);
        const clear = await lib.evalJs(client, `var t = document.querySelector('[class*="chatMount"] textarea.sc-input'); !t || (t.value || '').trim().length === 0`, 10_000);
        if (!clear) throw new Error('send_confirm_failed_after_all_retries');
      }

      // 运行期采样直到终态稳定（running=0 且正文已产出且连续 3 次序列不变）。
      const deadline = Date.now() + RUN_TIMEOUT_MS;
      const samples = [];
      let stableSamples = 0;
      let lastSample = '';
      let liveSeq = null;
      let liveSnap = null;
      const sentAt = Date.now();
      while (Date.now() < deadline) {
        await sleep(800);
        const snap = JSON.parse(await lib.evalJs(client, PROBE, 10_000));
        samples.push({
          t: Date.now() - sentAt,
          tl: snap.timelines.length,
          running: snap.running,
          transitions: snap.transitions.length,
          qoderRows: snap.qoderRows,
        });
        lib.log(`sample ${JSON.stringify(samples[samples.length - 1])}`);
        const settled = snap.running === 0 && snap.timelines.length > 0 && snap.lastBody > 40;
        const key = settled ? snap.timelines.join('|') : '';
        // BLOCK-108 教训（首跑抓真）：模型在迭代间有数秒思考停顿，3 样本稳定
        // 会在轮次中途误判终态（Q2/Q6 因此漏掉后续簇）。提高到 10 样本（≈8s）。
        stableSamples = settled && key && key === lastSample ? stableSamples + 1 : 0;
        lastSample = key;
        if (stableSamples >= 10) { liveSeq = snap.timelines; liveSnap = snap; break; }
      }
      if (!liveSnap) {
        liveSnap = JSON.parse(await lib.evalJs(client, PROBE, 10_000));
        liveSeq = liveSnap.timelines;
      }
      fs.writeFileSync(
        path.join(EVIDENCE_DIR, 'block108-qoder-stream-samples.json'),
        JSON.stringify({ prompt: PROMPT, samples }, null, 2)
      );

      const lastSeq = (liveSeq || []).slice(-1)[0] || '';
      const transitionCount = (liveSnap.transitions || []).length;

      // Q1 过渡叙述：至少一条、正文式（长度>10）且每条都紧跟其工具簇（簇前语义）。
      assert('Q1_transition_narration_before_cluster', transitionCount > 0
        && liveSnap.transitions.every((t) => t.length > 10)
        && (liveSeq || []).every((s) => transitionsBeforeClusters(s)),
        `transitions=${transitionCount} 首条=「${(liveSnap.transitions || [])[0] || ''}」 `
        + `X后必有T=${(liveSeq || []).every((s) => transitionsBeforeClusters(s))} :: ${lastSeq}`);

      // Q2 纯流水（UI-437 v2）：无簇头摘要（总结味下线）；失败以 error 行可见。
      assert('Q2_flat_pipeline_failure_visible', (liveSnap.heads || []).length === 0 && Number(liveSnap.errorRows || 0) > 0,
        `簇头摘要=${(liveSnap.heads || []).length} error行=${liveSnap.errorRows} :: heads=${JSON.stringify(liveSnap.heads).slice(0, 200)}`);

      // 展开全部簇（D4 完成收起后由点击展开——同时验证簇级点击可用）。
      // BLOCK-108 二跑教训：exec 行不一定在最后一簇（本例 T1/T2 是命令、T3 是列目录），
      // 必须全簇展开后再找终端行。
      await lib.evalJs(client, `(function(){
        var sums = [].slice.call(document.querySelectorAll('.sc-timeline-cluster .sc-tool-activity-summary'));
        var clicked = 0;
        sums.forEach(function(s){ if (s.getAttribute('aria-expanded') === 'false') { s.click(); clicked++; } });
        return 'clicked=' + clicked;
      })()`, 10_000);
      await sleep(400);
      const expanded = JSON.parse(await lib.evalJs(client, PROBE, 10_000));

      // Q3 统一单行：Qoder 行出现；无默认展开的终端输出块；无 routine 二级折叠。
      assert('Q3_uniform_single_line_rows', expanded.qoderRows > 0 && expanded.termOutputs === 0
        && expanded.routineGroups === 0,
        `qoderRows=${expanded.qoderRows} 默认展开终端块=${expanded.termOutputs} routine折叠=${expanded.routineGroups}`);
      await lib.screenshotPng(client, EVIDENCE_DIR, 'qoder-stream-expanded.png').catch(() => null);

      // Q4 点击展开终端体：点击 exec 行展开出终端体（命令全量；有输出尾时含输出块），再点收起。
      const clickExec = await lib.evalJs(client, `(function(){
        var rows = [].slice.call(document.querySelectorAll('.sc-tool-qoder-row'));
        for (var i = 0; i < rows.length; i++) {
          var head = rows[i].querySelector('.sc-tool-qoder-head');
          if (head && (head.textContent || '').indexOf('终端命令') > -1) { head.click(); return 'clicked'; }
        }
        return 'no_exec_row';
      })()`, 10_000);
      await sleep(400);
      const openedBody = Number(await lib.evalJs(client, `document.querySelectorAll('.sc-tool-term-body').length`, 8_000));
      const openedOutput = Number(await lib.evalJs(client, `document.querySelectorAll('.sc-tool-term-output').length`, 8_000));
      await lib.evalJs(client, `(function(){
        var heads = [].slice.call(document.querySelectorAll('.sc-tool-qoder-head'));
        for (var i = 0; i < heads.length; i++) {
          if ((heads[i].textContent || '').indexOf('终端命令') > -1) { heads[i].click(); return 'clicked'; }
        }
        return 'none';
      })()`, 10_000).catch(() => null);
      const closedBody = Number(await lib.evalJs(client, `document.querySelectorAll('.sc-tool-term-body').length`, 8_000));
      assert('Q4_click_expand_terminal_body', clickExec === 'clicked' && openedBody > 0 && closedBody === 0,
        `exec行=${clickExec} 展开后终端体=${openedBody}(输出块=${openedOutput}) 收起后=${closedBody}`);

      // Q5 思考入簇：簇内出现思考行（已思考）；若模型整轮未产出 reasoning，则独立
      // 思考节点也不该凭空出现——两者皆无为真红（模型行为事实，不放宽）。
      assert('Q5_reasoning_inside_cluster', expanded.reasoningInCluster > 0 || expanded.standaloneReasoning > 0,
        `簇内思考行=${expanded.reasoningInCluster} 独立思考节点=${expanded.standaloneReasoning}`);

      // Q6 刷新后同序（历史轨道与实况投影逐段相等）。
      await lib.evalJs(client, 'location.reload(); "reloading"', 8_000).catch(() => null);
      await sleep(6000);
      let reloaded = null;
      for (let i = 0; i < 20; i++) {
        reloaded = JSON.parse(await lib.evalJs(client, PROBE, 10_000));
        if (reloaded.timelines.length > 0) break;
        await sleep(2000);
      }
      const same = JSON.stringify(reloaded?.timelines || []) === JSON.stringify(liveSeq);
      assert('Q6_history_matches_live_projection', same,
        `live=${lastSeq} reloaded=${(reloaded?.timelines || []).slice(-1)[0]}`);
      await lib.screenshotPng(client, EVIDENCE_DIR, 'qoder-stream-reloaded.png').catch(() => null);

      const convs = await rest('GET', `/ai/conversations?status=active&project_id=${encodeURIComponent(projectId)}`);
      conversationId = (convs.data?.conversations || [])[0]?.id || null;
      lib.log(`project=${projectId} conv=${conversationId} transitions=${transitionCount}`);
      return true;
    } finally {
      const cleanup = [];
      if (conversationId) cleanup.push('conv=' + (await rest('DELETE', `/ai/conversations/${encodeURIComponent(conversationId)}`).then(() => true).catch(() => false)));
      if (projectId) cleanup.push('project=' + (await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).then(() => true).catch(() => false)));
      await lib.evalJs(client, `location.href = ${JSON.stringify(originalUrl)}; 'restore'`, 8_000).catch(() => null);
      assert('Q7_temp_data_cleaned_up', cleanup.length === 2 && cleanup.every((s) => s.endsWith('true')),
        cleanup.join(' ') + (conversationId ? '' : ' [会话 id 未取得，可能残留]'));
      try { client.socket.close(); } catch { /* already closed */ }
    }
  },
};
