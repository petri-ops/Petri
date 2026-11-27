'use strict';

/**
 * shared-backend/citation-discipline.js
 *
 * item 87 第一阶段 —— 引用纪律钉（HK-01 钉③，方案 §5.2「最关键」）。
 *
 * 领域断言必须带来源，且来源必须解析回真理源清单（sources.yaml）已登记条目。
 * 无来源 = 红；来源不在清单 = 红（「我的记忆里有一篇」不算来源——§6 方向性纪律：
 * 从库到文，不从文到库）。
 *
 * 本钉是纯函数，三个消费面：
 * 1. do-knowledge-store 钉①（卡片必有 sourceId）在入库面兜住；
 * 2. 资产 lint（test/item87-citation-discipline.test.mjs）对 playbook「依据:」行、
 *    品味样本「来源」行做批量核验——草稿也不能裸奔；
 * 3. 后续教练/写作面（88 第一波后）接入成稿终检。
 */

/** 断言数组逐条核验。返回 { ok, violations: [{statement, reason}] }。 */
function checkCitationDiscipline(assertions, sourceIndex) {
  const violations = [];
  for (const assertion of assertions || []) {
    if (!assertion || typeof assertion.statement !== 'string' || !assertion.statement.trim()) {
      violations.push({ statement: String(assertion && assertion.statement), reason: '断言内容缺失' });
      continue;
    }
    const sourceId = typeof assertion.sourceId === 'string' ? assertion.sourceId.trim() : '';
    if (!sourceId) {
      violations.push({ statement: assertion.statement, reason: '领域断言无来源=红' });
      continue;
    }
    if (!sourceIndex || !sourceIndex.has(sourceId)) {
      violations.push({ statement: assertion.statement, reason: `来源不在真理源清单：${sourceId}` });
    }
  }
  return { ok: violations.length === 0, violations };
}

/**
 * 从 playbook Markdown 提取「依据: <source-id>」行（资产面纪律的提取器，测试与
 * 未来成稿终检共用同一实现）。
 */
function extractPlaybookSourceRefs(markdownText) {
  const refs = [];
  for (const match of String(markdownText || '').matchAll(/^(?:[-*]\s+)?依据:\s*(\S+)\s*$/gm)) {
    refs.push(match[1]);
  }
  return refs;
}

module.exports = { checkCitationDiscipline, extractPlaybookSourceRefs };
