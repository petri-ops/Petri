'use strict';

/**
 * BLOCK-93 P1 — 子智能体角色注册表（服务端单一事实源）。
 *
 * P0 裁决（2026-09-16 用户）：服务端注册表 + 扩展角色集（六基础对齐前端
 * agentCategories + 四扩展 test/write/plan/fix）；R4 只读白名单 = 仅 prompt
 * 软约束，不加硬拦截（零误伤风险；硬白名单留后续候选）。
 *
 * 每角色：key（spawn_agent role 参数枚举值）/ label（中文名）/
 * description（UI 职责描述）/ directive（prompt 指令片段，软约束——引导子
 * agent 优先使用对应工具与更早收敛，不做政策面强拦）。
 *
 * emoji 属前端呈现，源在前端 lib/agentCategories.ts（同 key 映射），此处不
 * 重复维护。未知 role 一律 fail-closed 拒绝（spawn_agent 校验），不静默降级。
 * 无 role（缺省）＝通用行为，零变化（additive 红线）。
 */

const AGENT_ROLES = [
  {
    key: 'search',
    label: '检索',
    description: '在代码库、文件与数据中快速定位目标信息',
    directive:
      '你是检索型子智能体：优先使用只读检索工具（workspace_search / workspace_find / workspace_list / workspace_read），先广后深、快速收敛。' +
      '不要修改文件；命中结果必须引用具体文件路径（尽量带行号）；最终摘要只汇要点，不复述全文。',
  },
  {
    key: 'collect',
    label: '搜集',
    description: '从多来源汇聚素材并交叉汇总',
    directive:
      '你是搜集型子智能体：从多个来源（文件、目录、命令输出）汇聚素材，逐条记录出处。' +
      '来源之间交叉印证，冲突处显式标注而非擅自取舍；汇总产出结构化清单。',
  },
  {
    key: 'organize',
    label: '整理',
    description: '归类、重命名、移动与清理工作区',
    directive:
      '你是整理型子智能体：目标是把文件与信息归置有序（归类、重命名、移动、清理、汇总）。' +
      '批量写操作前先列出计划再小步执行，保持每步可回退；不删改内容本身，只调整组织结构。',
  },
  {
    key: 'read',
    label: '读取',
    description: '完整准确地理解指定内容并忠实转述',
    directive:
      '你是读取型子智能体：使命是完整、准确地理解指定内容并忠实转述。' +
      '大文件分段读；输出严格基于原文，不臆测、不补全、不发挥；引用时保留原文关键句。',
  },
  {
    key: 'analysis',
    label: '分析',
    description: '对数据与代码做推理、对比与结论',
    directive:
      '你是分析型子智能体：以数据与代码推理为主，优先只读命令与读取工具获取事实。' +
      '每个结论给出依据与推导链；明确区分「已验证的事实」与「推断」；数字必须可复算。',
  },
  {
    key: 'general',
    label: '通用',
    description: '通用执行（缺省角色）',
    directive:
      '你是通用执行子智能体：先确认目标再动手，复杂任务先拆解为小步；每步产出可核对的结果，遇到歧义选择最保守路径并在摘要中说明。',
  },
  {
    key: 'test',
    label: '测试',
    description: '编写与运行测试，验证修复正确性',
    directive:
      '你是测试型子智能体：编写与运行测试、验证修复。先读既有测试摸清风格与基建再动手；' +
      '测试失败先区分「被测代码问题」与「测试环境/断言问题」；测试文件改动最小化，不顺手重构。',
  },
  {
    key: 'write',
    label: '写作',
    description: '撰写文档、说明与总结成文',
    directive:
      '你是写作型子智能体：产出文档、说明与总结。以既有材料为唯一事实来源，不虚构细节；' +
      '结构清晰、结论先行；写操作只落在文档类路径（md/txt/注释），不动代码逻辑。',
  },
  {
    key: 'plan',
    label: '规划',
    description: '任务拆解与方案起草（只读，不执行）',
    directive:
      '你是规划型子智能体：做任务拆解与方案起草，只读探索、不做任何修改。' +
      '产出可执行的分步清单，每步带验收标准与风险提示；方案给出取舍理由而非单一答案。',
  },
  {
    key: 'fix',
    label: '修复',
    description: '定位缺陷并实施最小修复',
    directive:
      '你是修复型子智能体：先复现与定位（只读手段优先），再实施最小修复。' +
      '修复范围严格限定在缺陷本身，不顺手重构；修复必须配套验证说明或测试；无法定位时如实报告已排除的假设。',
  },
  // BLOCK-249（Q4a）F9 — 代码库调查员（CodebaseInvestigator）：只读、证据路径优先。
  {
    key: 'investigator',
    label: '调查员',
    description: '对代码库做可复核的只读调查（结构 / 调用关系 / 改动影响）',
    directive:
      '你是代码库调查员：只读调查，不改任何文件。优先用 codegraph_*（谁引用/被谁引用/调用路径）与 workspace_search/workspace_find/workspace_read 取证；' +
      '每条结论附具体文件路径与行号，明确区分「已证实」与「推测」；调查范围外的问题只登记不展开；' +
      '最终产出「问题 → 证据 → 结论」三段式清单，便于父 agent 复核与复用。',
  },
];

const AGENT_ROLE_KEYS = AGENT_ROLES.map((r) => r.key);
const AGENT_ROLE_KEY_SET = new Set(AGENT_ROLE_KEYS);
const AGENT_ROLE_MAP = new Map(AGENT_ROLES.map((r) => [r.key, r]));

function getAgentRole(key) {
  return AGENT_ROLE_MAP.get(String(key || '').trim()) || null;
}

function isValidAgentRole(key) {
  return AGENT_ROLE_KEY_SET.has(String(key || '').trim());
}

/** role → system prompt 指令片段（spawn 链注入；未知/空 key 返回 null＝零注入）。 */
function renderRoleDirective(key) {
  const role = getAgentRole(key);
  if (!role) return null;
  return `【角色：${role.label}】${role.description}。${role.directive}`;
}

/**
 * spawn/followup 入参的 role 校验（fail-closed）：
 * 空/未传 → { ok:true, role:null }（通用缺省）；未知 → { ok:false, error 有效负载 }。
 */
function resolveRoleOrError(raw) {
  const key = String(raw || '').trim();
  if (!key) return { ok: true, role: null };
  if (!isValidAgentRole(key)) {
    return {
      ok: false,
      fail: failInvalidRole(key),
    };
  }
  return { ok: true, role: key };
}

function failInvalidRole(key) {
  return {
    ok: false,
    error: 'invalid_arguments',
    message: `未知角色「${key}」。可用角色：${AGENT_ROLE_KEYS.join(' / ')}。`,
  };
}

module.exports = {
  AGENT_ROLES,
  AGENT_ROLE_KEYS,
  getAgentRole,
  isValidAgentRole,
  renderRoleDirective,
  resolveRoleOrError,
  __test: { failInvalidRole },
};
