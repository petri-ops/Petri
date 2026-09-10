#!/usr/bin/env node
'use strict';
// P5 修复：从 HEAD 恢复被误删的 runSshDirectToolJob，并叠加 activeDirectJobs 登记。
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'core', 'biof3-server', 'helpers', 'tools-executor.js');

const head = execFileSync('git', ['show', 'HEAD:core/biof3-server/helpers/tools-executor.js'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
const START = '  async function runSshDirectToolJob({';
const END = '\n  /**\n   * 重启恢复（D5.2 启动扫描）';
const hs = head.indexOf(START);
const he = head.indexOf(END);
if (hs < 0 || he < 0 || he <= hs) { console.error('HEAD markers not found', hs, he); process.exit(1); }
let fn = head.slice(hs, he);
// 叠加 P5 直跑取消登记：start 后登记 pid；各退出点清理
fn = fn.replace(
  '    const pid = started.pid;\n',
  '    const pid = started.pid;\n    activeDirectJobs.set(jobId, { runner, pid });\n',
);
fn = fn.split('releaseActiveToolJob(activeToolJobs, jobId, owner);').join('activeDirectJobs.delete(jobId);\n      releaseActiveToolJob(activeToolJobs, jobId, owner);');

let work = fs.readFileSync(FILE, 'utf8');
const INSERT_BEFORE = '  /**\n   * 重启恢复（D5.2 启动扫描）';
const ws = work.indexOf(INSERT_BEFORE);
if (ws < 0) { console.error('insert point not found'); process.exit(1); }
work = work.slice(0, ws) + fn + work.slice(ws);
fs.writeFileSync(FILE, work);
console.log('runSshDirectToolJob restored + activeDirectJobs wired');
