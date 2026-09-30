import React, { useRef } from 'react';
import { Icon } from '@/components/icons/Icon';
import { dispatchGewuEvent, gewuEvents } from '@/lib/events';
import { useToolCatalog } from '@/lib/tool-catalog';
import type { ResultArtifactKind } from '@/lib/result-manifest';
import styles from './ContinueAnalysisMenu.module.css';

export interface ContinueAnalysisMenuProps {
  /** 来源工具任务 ID（prompt 三要素之一，Agent 侧 bind_artifact 血统链 fail-closed 校验）。 */
  jobId: string;
  /** 当前结果产物文件名。 */
  artifactName: string;
  /** 当前产物分类（result-manifest classifyArtifact 结果）。 */
  artifactKind: ResultArtifactKind;
}

/** 组装发给 Agent 的显式中文指令（jobId/artifactName/tool 三要素齐全）。 */
function buildContinuePrompt(jobId: string, artifactName: string, toolTitle: string): string {
  return (
    `请基于任务 ${jobId} 的结果 ${artifactName} 运行「${toolTitle}」分析：` +
    '从该结果的表格产物取输入（如 DEG 表），完成血统绑定后执行；完成后报告新任务 ID。'
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
 */
export function ContinueAnalysisMenu({
  jobId,
  artifactName,
  artifactKind,
}: ContinueAnalysisMenuProps): React.ReactElement | null {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const { tools: catalogTools } = useToolCatalog();
  // 目录驱动：排除无文件输入的分析（纯展示/对话型），其余都可作为继续分析候选——
  // 与分析入口面板（AnalysisLaunchPanel）同一目录来源，领域语义归插件声明。
  const candidates = catalogTools.filter((tool) => !tool.comingSoon && tool.inputs.some((input) => input.type === 'file'));
  if (!jobId || !artifactName || candidates.length === 0) return null;

  const runDownstream = (toolTitle: string): void => {
    dispatchGewuEvent(gewuEvents.copilotAsk, {
      prompt: buildContinuePrompt(jobId, artifactName, toolTitle),
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
