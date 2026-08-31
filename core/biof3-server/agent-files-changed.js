'use strict';

/**
 * agent-files-changed.js — BLOCK-31 P1 权威「任务改动文件清单」聚合
 *
 * 在 agent task 终态时回放本 task 的 task_events，从成功的
 * workspace_write / workspace_replace 工具结果中提取改动文件集合：
 *   - status: 'created'（写入前不存在）/ 'modified'（覆写或替换）
 *   - 文件级去重（Map 按 path，后写覆盖先写）
 *   - dryRun 不算改动
 *   - 数据预览截断（publicData 1600 字符上限）时回退到 tool_call 的
 *     args.path（按 callId 关联），并标记 attributionComplete=false
 *
 * 已知盲区（诚实边界，不做伪归属）：workspace_exec（shell 命令写文件）
 * 不经过 workspace_write 记录，无法精确归属；调用方应把「存在 exec 调用」
 * 视为清单可能不完整的信号（unattributedExec）。
 */

const WRITE_TOOLS = new Set(['workspace_write', 'workspace_replace']);

function isPreviewOnly(data) {
  return Boolean(
    data && typeof data === 'object' && typeof data.preview === 'string' && !data.path
  );
}

/**
 * @param {Array<{seq:number,eventType:string,payload:object}>} events 按 seq 升序
 * @returns {{ files: Array<{path:string,status:'created'|'modified'}>, attributionComplete: boolean, sawExec: boolean }}
 */
function aggregateFilesChanged(events) {
  const callArgsByCallId = new Map();
  const files = new Map();
  let attributionComplete = true;

  for (const ev of events || []) {
    const payload = ev && ev.payload;
    if (!payload || typeof payload !== 'object') continue;

    if (payload.event === 'tool_call') {
      if (WRITE_TOOLS.has(payload.name) && payload.callId) {
        const args = payload.args || {};
        callArgsByCallId.set(payload.callId, {
          path: typeof args.path === 'string' ? args.path : null,
          dryRun: args.dryRun === true,
        });
      } else if (payload.name === 'workspace_exec') {
        // exec 是否写过文件不可静态判定，仅作为「清单可能不完整」的信号
      }
      continue;
    }

    if (payload.event !== 'tool_result') continue;
    const tr = payload.toolResult || {};
    if (!WRITE_TOOLS.has(tr.tool)) continue;
    if (tr.terminationReason === 'approval_required') continue;

    const data = tr.data;
    let path = null;
    let created = null;
    let dryRun = false;

    if (data && typeof data === 'object' && !isPreviewOnly(data)) {
      if (data.ok !== true) continue; // 失败的写入不算改动
      path = typeof data.path === 'string' ? data.path : null;
      created = data.created === true;
      dryRun = data.dryRun === true;
    } else {
      // 结果数据被 publicData 截断为 preview —— 回退到 tool_call 的 args.path
      attributionComplete = false;
      const callInfo = tr.callId ? callArgsByCallId.get(tr.callId) : null;
      if (!callInfo || !callInfo.path) continue;
      path = callInfo.path;
      dryRun = callInfo.dryRun;
    }

    if (!path || dryRun) continue;
    files.set(path, { path, status: created ? 'created' : 'modified' });
  }

  return {
    files: Array.from(files.values()),
    attributionComplete,
  };
}

/**
 * 从 agentTaskStore 回放指定 task 的全部事件并聚合。
 * 供 agent-runner 终态判定处调用（任何失败都由调用方 catch）。
 */
function collectFilesChangedForTask(agentTaskStore, taskId, { eventLimit = 20000 } = {}) {
  const events = agentTaskStore.getAgentTaskEventsSince(taskId, 0, eventLimit);
  return aggregateFilesChanged(events);
}

module.exports = {
  WRITE_TOOLS,
  aggregateFilesChanged,
  collectFilesChangedForTask,
};
