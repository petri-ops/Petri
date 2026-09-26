// G-03（BLOCK-123 P0 缺口清单）——测试实例会话残留清理工具契约（红绿先行：先于实现落盘）。
// 语义：只匹配「探针/走查/取证/验收」类命名模式的会话标题，绝不误伤用户真实会话。
import test from 'node:test';
import assert from 'node:assert/strict';
import { isTestSessionTitle } from '../scripts/test-session-cleanup.mjs';

test('匹配探针/走查/取证/验收类命名', () => {
  assert.equal(isTestSessionTitle('UI444-取证-1790390262426'), true);
  assert.equal(isTestSessionTitle('UI442-取证-1790385994119'), true);
  assert.equal(isTestSessionTitle('BLOCK123-审阅面-1790410068372'), true);
  assert.equal(isTestSessionTitle('BLOCK121-验收-1790409000000'), true);
  assert.equal(isTestSessionTitle('BLOCK123-走验-1790409252970'), true);
  assert.equal(isTestSessionTitle('LIVE-VERIFY2-1790003812064'), true);
  assert.equal(isTestSessionTitle('B-Goals-PASS-1790211333608'), true);
  assert.equal(isTestSessionTitle('B109-spawn-1789972542860'), true);
  assert.equal(isTestSessionTitle('probe-manual-test'), true);
});

test('不匹配用户真实会话（防误伤）', () => {
  assert.equal(isTestSessionTitle('子智能体派发被只读拦截'), false);
  assert.equal(isTestSessionTitle('知识空间管理台'), false);
  assert.equal(isTestSessionTitle('帮我写一个爬虫'), false);
  assert.equal(isTestSessionTitle(''), false);
  assert.equal(isTestSessionTitle(null), false);
  assert.equal(isTestSessionTitle(undefined), false);
});
