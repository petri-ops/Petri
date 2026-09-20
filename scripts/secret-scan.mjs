#!/usr/bin/env node
'use strict';
/**
 * secret-scan.mjs — BLOCK-105 P1 密钥泄漏门禁（Node 等价实现）
 *
 * D2 裁决：扫描器类不进 package.json 控传递依赖膨胀——本脚本用 git grep 模式集
 * 实现与 Gitleaks 等价的最小密钥检测；若用户全局安装 gitleaks，可切换原生通道
 * （scripts 侧接口不变）。P0 基线：14 处命中全为 test/ fixture（假密钥/脱敏测试），
 * 生产面零命中——本门禁固化该状态：
 *   - 生产面（src/ core/ scripts/ frontend/src/）命中任意模式 → exit 1（fail-closed）；
 *   - test/ 命中 → 打印计数放行（fixture 假密钥属测试资产，列入观察不阻塞）；
 *   - 任何输出绝不打印密钥内容本身（只给路径 + 模式名）。
 *
 * 用法：node scripts/secret-scan.mjs   （npm run quality:secret）
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 密钥模式集（模式名 → git grep -E 正则；与 Gitleaks 常用规则对齐的最小子集）
const PATTERNS = {
  openai_like: 'sk-[a-zA-Z0-9]{20,}',
  github_pat_classic: 'ghp_[a-zA-Z0-9]{30,}',
  github_pat_fine: 'github_pat_[a-zA-Z0-9_]{20,}',
  aws_access_key: 'AKIA[0-9A-Z]{16}',
  slack_token: 'xox[abp]-[a-zA-Z0-9-]{10,}',
  private_key: 'BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY',
  generic_api_key_literal: 'api[_-]?key[\'"]?\\s*[:=]\\s*[\'"][a-zA-Z0-9]{16,}[\'"]',
  bearer_literal: "Authorization['\"]?\\s*[:=]\\s*['\"]Bearer [a-zA-Z0-9]{20,}",
};

// 已知 fixture 白名单（P0 基线核实：测试桩假密钥/脱敏测试，非泄漏）。
// 新增豁免必须在此登记 reason，禁止静默放宽模式。
const FIXTURE_ALLOWLIST = new Set([
  'test/agent-tool-result.test.mjs',
  'test/diagnostic-redaction.test.mjs',
  'test/git-adapter.test.mjs',
  'test/loop-contract.test.mjs',
  'test/loop-controller.test.mjs',
  'test/p4r-ui-observation.test.mjs',
  'test/scientific-task-spec.test.mjs',
]);

// 前缀豁免：引用 test fixture 内容的报告/证据产物（如 eslint-report JSON 把
// test 文件的行内容复制进来）——间接命中按 fixture 处理，非真实泄漏。
const FIXTURE_PREFIX_ALLOWLIST = ['acceptance/block-105/'];

function scan() {
  const production = [];
  const fixture = [];
  for (const [name, pattern] of Object.entries(PATTERNS)) {
    let out = '';
    try {
      out = execFileSync(
        'git',
        ['grep', '-lIE', pattern, '--', ':!*.lock', ':!package-lock.json', ':!frontend/package-lock.json'],
        { encoding: 'utf8', cwd: ROOT },
      );
    } catch {
      continue; // git grep 无命中时退出码 1
    }
    for (const line of out.split('\n')) {
      if (!line) continue;
      const rel = line.split(path.sep).join('/');
      if (FIXTURE_ALLOWLIST.has(rel) || FIXTURE_PREFIX_ALLOWLIST.some((p) => rel.startsWith(p))) {
        fixture.push({ file: rel, pattern: name });
      } else {
        production.push({ file: rel, pattern: name });
      }
    }
  }
  return { production, fixture };
}

const { production, fixture } = scan();
console.log(`[secret-scan] 生产面命中: ${production.length} | fixture 豁免命中: ${fixture.length}（白名单 ${FIXTURE_ALLOWLIST.size} 文件）`);
for (const { file, pattern } of production) {
  console.error(`  [LEAK?] ${file} — 模式 ${pattern}（内容已隐去，人工核验）`);
}
for (const { file, pattern } of fixture) {
  console.log(`  [fixture] ${file} — 模式 ${pattern}`);
}
if (production.length > 0) {
  console.error(`[secret-scan] FAIL — 生产面存在疑似密钥，必须人工核验并处置（入库轮换/删除/豁免登记）。`);
  process.exit(1);
}
console.log('[secret-scan] PASS');
