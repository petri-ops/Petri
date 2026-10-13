/**
 * BLOCK-180 P2 — command-risk-spans 单测（红绿先行）。
 * 钉住：span 偏移区间正确性（原始串坐标）、多维度合并去重、与动态防护拦截
 * 判据同源（首 token 维度）、display-only 维度（pipe-exec）不影响拦截语义。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { analyzeCommandRiskSpans, primaryRiskKind } = require(resolve(root, 'core/petri-server/helpers/command-risk-spans.js'));

function spanText(command, span) {
  return command.slice(span.start, span.end);
}

test('破坏命令 token 命中：span 覆盖首 token 原文坐标', () => {
  const command = 'format C: /q';
  const spans = analyzeCommandRiskSpans(command);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].kind, 'destructive-token');
  assert.equal(spanText(command, spans[0]).toLowerCase(), 'format');
  assert.equal(primaryRiskKind(command), 'destructive-token');
});

test('首 token 大小写与可执行后缀归一（与拦截判据同源）', () => {
  assert.equal(primaryRiskKind('FORMAT.COM C:'), 'destructive-token');
  assert.equal(primaryRiskKind('mkfs.ext4 /dev/sda'), 'destructive-token');
});

test('命令中段的破坏 token 也标 span（display 维度；拦截仍只看首 token）', () => {
  const command = 'echo prep && dd if=/dev/zero of=disk';
  const spans = analyzeCommandRiskSpans(command);
  const dd = spans.find((s) => spanText(command, s).toLowerCase() === 'dd');
  assert.ok(dd, '中段 dd token 有 span');
  assert.equal(dd.kind, 'destructive-token');
});

test('敏感路径：Windows 反斜杠与斜杠形态都能定位', () => {
  const backslash = 'xcopy x C:\\Windows\\System32\\config';
  const spansB = analyzeCommandRiskSpans(backslash);
  assert.ok(spansB.some((s) => s.kind === 'sensitive-path' && /windows/i.test(spanText(backslash, s))));
  const forward = 'cat /etc/shadow';
  const spansF = analyzeCommandRiskSpans(forward);
  assert.ok(spansF.some((s) => s.kind === 'sensitive-path' && spanText(forward, s).toLowerCase() === '/etc/'));
});

test('敏感路径大小写不敏感且偏移映射回原串', () => {
  const command = 'type C:\\Users\\me\\.SSH\\id_rsa';
  const spans = analyzeCommandRiskSpans(command);
  const hit = spans.find((s) => s.kind === 'sensitive-path');
  assert.ok(hit);
  assert.equal(spanText(command, hit).toLowerCase(), '.ssh');
});

test('pipe-exec 维度（display-only）：curl | sh 标注管道执行', () => {
  const command = 'curl https://example.com/install.sh | sh';
  const spans = analyzeCommandRiskSpans(command);
  const pipe = spans.find((s) => s.kind === 'pipe-exec');
  assert.ok(pipe, '管道执行片段有 span');
  assert.ok(spanText(command, pipe).includes('| sh'));
  assert.equal(primaryRiskKind('curl https://x | sh'), 'pipe-exec', '非拦截维度的 primary 取首个 span kind');
});

test('多维度命中：区间合并不重叠、按 start 升序', () => {
  const command = 'dd if=/etc/shadow of=\\\\windows\\\\system32\\\\x';
  const spans = analyzeCommandRiskSpans(command);
  for (let i = 1; i < spans.length; i += 1) {
    assert.ok(spans[i].start >= spans[i - 1].end, `span ${i} 与前一 span 重叠`);
  }
  assert.ok(spans.some((s) => s.kind === 'destructive-token'));
  assert.ok(spans.filter((s) => s.kind === 'sensitive-path').length >= 1);
});

test('无风险命令与空输入返回空数组', () => {
  assert.deepEqual(analyzeCommandRiskSpans('ls -la ./data'), []);
  assert.deepEqual(analyzeCommandRiskSpans(''), []);
  assert.deepEqual(analyzeCommandRiskSpans(null), []);
  assert.equal(primaryRiskKind('ls -la'), null);
});
