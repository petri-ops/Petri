import React, { useRef } from 'react';
import { Icon } from '@/components/icons/Icon';
import { dispatchGewuEvent, gewuEvents } from '@/lib/events';
import { useToolCatalog } from '@/lib/tool-catalog';
import { MAX_AGENT_SAMPLE_IDS, MAX_PERSISTED_ENTITY_IDS, type ArtifactSelection } from '@/lib/artifact-selection';
import { useSelectionBus } from '@/lib/selectionBus';
import styles from './ContinueAnalysisMenu.module.css';

export interface ContinueAnalysisMenuProps {
  /** 来源工具任务 ID（prompt 三要素之一，Agent 侧 bind_artifact 血统链 fail-closed 校验）。 */
  jobId: string;
  /** 当前结果产物文件名。 */
  artifactName: string;
  // BLOCK-151 B 轨：artifactKind prop 移除——自 BLOCK-83 D7 起菜单目录驱动
  // （文件输入过滤），产物分类从不过滤菜单项；原「决定下游分析项」声明与
  // 实现不符（死 prop），一并摘除。
}

/** 组装发给 Agent 的显式中文指令（jobId/artifactName/tool 三要素齐全）。 */
function buildContinuePrompt(jobId: string, artifactName: string, toolTitle: string): string {
  return (
    `请基于任务 ${jobId} 的结果 ${artifactName} 运行「${toolTitle}」分析：` +
    '从该结果的表格产物取输入（如 DEG 表），完成血统绑定后执行；完成后报告新任务 ID。'
  );
}

/**
 * BLOCK-139 P1（「继续分析」实体坐标驱动，g0-result-studio-plan §22.2 #1）+ 评审
 * P1-2 修订：prompt 只如实陈述实际携带的内容——计数 + entityType + 标记列 +
 * ≤12 样本（D3 有界）。完整实体列表到达 Agent 的通道是既有结果选择持久化
 * （shell 写入时 saveResultStudioSelection → selectionId → selection/current）：
 * 已持久化（selectionId 在）如实注明；未持久化明说仅携带样本，绝不向 Agent
 * 声称消息里带了完整列表。无选择时 prompt 保持既有三要素形态。
 */
function appendSelectionToPrompt(
  prompt: string,
  selection: ArtifactSelection,
  idField: string | null,
): string {
  const sample = selection.entityIds.slice(0, MAX_AGENT_SAMPLE_IDS);
  const truncatedNote = selection.entityIdsTruncated
    ? `（真实规模 ${selection.entityIdCount}，样本列表按 ${MAX_PERSISTED_ENTITY_IDS} 上限截断）`
    : '';
  const persistenceNote = selection.selectionId
    ? `完整实体列表已随选择保存（selectionId: ${selection.selectionId}），可经结果选择通道读取`
    : '本消息仅携带以上样本，不携带完整列表';
  return (
    `${prompt}用户已选中 ${selection.entityIdCount} 个 ${selection.entityType}`
    + `${idField ? `（标记列 ${idField}）` : ''}：${sample.join('、')}${truncatedNote}`
    + `——${persistenceNote}，请优先基于所选实体执行分析。`
  );
}

/**
 * 「继续分析」显式入口：上游结果喂下游分析必须经 Agent 对话（bind_artifact 血统绑定），
 * 本菜单把该路径显式化——点击菜单项即组装 prompt 经 `gewu:copilot-ask` 投递给 Agent，
 * 不在前端直接发起任何分析请求。
 *
 * BLOCK-83 D7：菜单项来自插件目录（useToolCatalog 已装分析），核心前端不写死
 * 领域工具 ID——新装分析自动出现在菜单，卸载自动消失。不匹配任何输入的
 * 目录项由 Agent 侧 run_tool 输入契约 fail-closed 兜底，前端不预判语义。
 *
 * BLOCK-139 P1：选择总线（D1 单选择真相）持有当前选择时，派发负载随
 * `selection` 携带真实实体列表（entityType + idField + entityIds ≤2000 有界），
 * 「继续分析」由真实实体列表驱动，不再只是整表泛指。
 */
export function ContinueAnalysisMenu({
  jobId,
  artifactName,
}: ContinueAnalysisMenuProps): React.ReactElement | null {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const { tools: catalogTools } = useToolCatalog();
  const selectionBus = useSelectionBus();
  const busSelection = selectionBus.selection;
  // 目录驱动：排除无文件输入的分析（纯展示/对话型），其余都可作为继续分析候选——
  // 与分析入口面板（AnalysisLaunchPanel）同一目录来源，领域语义归插件声明。
  const candidates = catalogTools.filter((tool) => !tool.comingSoon && tool.inputs.some((input) => input.type === 'file'));
  if (!jobId || !artifactName || candidates.length === 0) return null;

  const runDownstream = (toolTitle: string): void => {
    const basePrompt = buildContinuePrompt(jobId, artifactName, toolTitle);
    dispatchGewuEvent(gewuEvents.copilotAsk, {
      prompt: busSelection
        ? appendSelectionToPrompt(basePrompt, busSelection, selectionBus.idField)
        : basePrompt,
    });
    if (detailsRef.current) detailsRef.current.open = false;
  };

  return (
    <details className={styles.menu} ref={detailsRef}>
      <summary aria-haspopup="menu" aria-label="继续分析" title="继续分析（经 Agent 对话）">
        <Icon name="git-branch" size={14} />
        <span>继续分析</span>
      </summary>
      <div className={styles.popup}>
        <div className={styles.popupLabel}>已装分析 · 经 Agent 血统绑定后执行</div>
        <div className={styles.items}>
          {candidates.map((tool) => (
            <button
              key={tool.id}
              type="button"
              aria-label={tool.title}
              title={tool.title}
              onClick={() => runDownstream(tool.title)}
            >
              <span>{tool.title}</span>
              <small>{tool.id}</small>
            </button>
          ))}
        </div>
      </div>
    </details>
  );
}
