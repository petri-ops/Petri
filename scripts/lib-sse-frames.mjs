/**
 * lib-sse-frames.mjs — SSE 帧解析与终态判据纯函数（M-55 / BLOCK-451）。
 *
 * 与 scripts/c17b-streaming-sse.mjs 的采集口径同源（按 \n\n 切帧、data: 去前缀），
 * 抽成可单测纯函数以固化真实端点行为契约。零出网、零后端、零依赖。
 * 供 test/m4-sse-real-endpoint.test.mjs 与真实端点采集脚本复用。
 */

/**
 * 解析 SSE 字节流为帧列表。
 * @param {string|null} chunk 一次喂入的文本；null 表示流结束（flush 尾部半帧）
 * @param {(frame)=>void} [onFrame] 流式回调；提供时逐帧推送并返回累加器函数
 * @returns {Array|Function} 帧数组，或（提供 onFrame 时）可重复调用的 feed 函数
 *
 * 帧结构：{ raw: string, json: object|null }。
 *  - 裸 [DONE] → { raw:'[DONE]', json:null }（不经 JSON.parse，前端据此判终态）
 *  - data: <json> → { raw:<json文本>, json:<对象> }（解析失败 json=null）
 *  - `: ping` 注释行 → 不产出帧（对解析器透明，只维持连接）
 */
export function parseSseStream(chunk, onFrame) {
  const frames = [];
  let buf = '';

  const emit = (rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    if (!line.startsWith('data:')) return; // : ping / event: / id: 等均跳过
    const raw = line.slice(5).trim();
    if (raw === '[DONE]') {
      const frame = { raw: '[DONE]', json: null };
      frames.push(frame);
      if (onFrame) onFrame(frame);
      return;
    }
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { /* 非 JSON data 帧保留 raw，json=null */ }
    const frame = { raw, json: parsed };
    frames.push(frame);
    if (onFrame) onFrame(frame);
  };

  const drain = (final) => {
    let sep;
    while ((sep = buf.indexOf('\n\n')) !== -1) {
      emit(buf.slice(0, sep));
      buf = buf.slice(sep + 2);
    }
    if (final && buf.trim()) emit(buf);
  };

  if (typeof onFrame === 'function') {
    // 流式模式：返回闭包 feed，跨调用保留半帧缓冲
    let inner = '';
    return (piece) => {
      if (piece === null) {
        let sep;
        while ((sep = inner.indexOf('\n\n')) !== -1) {
          emit(inner.slice(0, sep));
          inner = inner.slice(sep + 2);
        }
        if (inner.trim()) emit(inner);
        return;
      }
      inner += piece;
      let sep;
      while ((sep = inner.indexOf('\n\n')) !== -1) {
        emit(inner.slice(0, sep));
        inner = inner.slice(sep + 2);
      }
    };
  }

  // 整段模式
  if (chunk != null) buf += chunk;
  drain(true);
  return frames;
}

/**
 * 对解析后的帧序列做终态判据。
 * @returns {{terminalOrder:string[], terminalStatus:string|null, filesChanged:any[],
 *            hasDoneSentinel:boolean, issues:string[]}}
 */
export function classifySseFrames(frames) {
  const issues = [];
  const terminalOrder = [];
  let terminalStatus = null;
  let filesChanged = [];

  for (const f of frames) {
    const j = f.json;
    if (f.raw === '[DONE]') {
      terminalOrder.push('DONE');
      continue;
    }
    if (!j) continue;
    switch (j.eventType) {
      case 'run_terminal':
        terminalOrder.push('run_terminal');
        terminalStatus = j.payload && j.payload.status;
        if (j.payload && Array.isArray(j.payload.filesChanged)) filesChanged = j.payload.filesChanged;
        break;
      default:
        break;
    }
    // loop 内部的 eventType:"done" 是普通迭代事件，不进终态序列；
    // 真正的终态摘要是裸 event:"done" 帧（无 eventType），见下方分支。
    // done 摘要帧：{ "event":"done", "filesChanged":[...] }（无 eventType，裸 event）
    if (!j.eventType && j.event === 'done') {
      terminalOrder.push('done_summary');
      if (Array.isArray(j.filesChanged)) filesChanged = j.filesChanged;
    }
    if (!j.eventType && j.event === 'error') {
      terminalStatus = 'failed';
    }
  }

  const hasDoneSentinel = frames.some((f) => f.raw === '[DONE]');
  if (!hasDoneSentinel) issues.push('MISSING_DONE_SENTINEL');
  if (terminalStatus === 'failed' || !terminalStatus) {
    // failed 必须在调用方按语义判红；此处仅当显式 failed 时标具名 issue
    if (terminalStatus === 'failed') issues.push('TERMINAL_FAILED');
  }
  if (!terminalOrder.includes('run_terminal')) issues.push('MISSING_RUN_TERMINAL');

  return { terminalOrder, terminalStatus, filesChanged, hasDoneSentinel, issues };
}
