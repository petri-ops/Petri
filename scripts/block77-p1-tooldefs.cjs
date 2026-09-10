#!/usr/bin/env node
'use strict';
// BLOCK-77 P1 — tool-defs 追加三个驻留任务工具定义（一次性手术脚本，用后即删）。
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'core', 'biof3-server', 'agent-tools', 'tool-defs.js');
let t = fs.readFileSync(FILE, 'utf8');

// 唯一锚：process_status 定义的 description 行（含长描述，全文唯一）
const anchor = "        '查询本会话通过 workspace_exec_background 启动的后台进程状态：存活/退出/停止、退出码、运行时长与日志尾部。不带 processId 时返回本会话全部后台进程；进程表为内存态，应用重启后失效（日志文件仍在，可手工查看）。',";
const idx = t.indexOf(anchor);
if (idx < 0) { console.error('anchor not found'); process.exit(1); }

// 该 description 所在 tool-def 对象的收尾 "},\n  }," —— 从 anchor 向后找第一个 "},\n  },"
const closeIdx = t.indexOf('},\n  },', idx);
if (closeIdx < 0) { console.error('close marker not found'); process.exit(1); }
const insertAt = closeIdx + '},\n  },'.length;

const defs = `
  {
    type: 'function',
    function: {
      name: 'resident_task_create',
      description:
        'BLOCK-77 驻留任务创建：后台启动长时命令（复用 workspace_exec_background 通道）并在项目 .gewu/resident/ 一次成型落盘「意图卡」（taskId/意图/成功标准/失败处置/backing pid/日志路径/状态机）。意图卡是跨会话交接班凭据：软件重开后可经 resident_task_list/read 读取续接。软件关闭不影响已在服务器/本机 detached 运行的进程。需完全访问模式。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要挂机后台执行的 shell 命令（长时运行，如训练/流水线/服务）' },
          intent: { type: 'string', description: '意图卡核心字段：这个任务在干什么（一句话，写清楚目的与产出物位置）' },
          success_criteria: { type: 'string', description: '成功标准：怎样算完成（如退出码 0 且 results/ 下有输出）' },
          failure_handling: { type: 'string', description: '失败处置预案：失败时留什么/做什么（仅记录，回访循环不会自动重启）' },
          cwd: { type: 'string', description: '相对项目根目录的工作子目录（可选，必须已存在）' },
        },
        required: ['command', 'intent'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resident_task_list',
      description:
        '列出本项目全部驻留任务意图卡（.gewu/resident/*.json，按创建时间倒序）。用于交接班：重开软件/新会话先读清单，了解有哪些挂机任务、各自意图与状态。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resident_task_read',
      description:
        '读取单张驻留任务意图卡全文（intent/成功标准/失败处置/backing pid/日志路径/状态/最近回访记录）。',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'resident_task_list 返回的 taskId' },
        },
        required: ['taskId'],
      },
    },
  },`;

t = t.slice(0, insertAt) + defs + t.slice(insertAt);
fs.writeFileSync(FILE, t);
console.log('tool-defs appended');
