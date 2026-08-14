/**
 * Skill 类型定义
 * 从 useSkillStore 重新导出，保持向后兼容
 */

export type {
  Skill,
  SkillSource,
  ParameterSchema,
  ParameterType,
  OutputArtifact,
  SkillExecution,
  ExecutionStatus,
} from '@/hooks/useSkillStore';

// Additional utility types for UI
export interface SkillSummary {
  id: string;
  name: string;
  version: string;
  source: string;
  category: string;
  tags: string[];
  description: string;
  requiredPlugins: string[];
  hasOptionalPlugins: boolean;
}

export interface SkillStats {
  total: number;
  bySource: Record<string, number>;
  byCategory: Record<string, number>;
}

export interface SkillFilter {
  query?: string;
  source?: string;
  category?: string;
  tag?: string;
}
