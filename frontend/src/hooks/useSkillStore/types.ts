// BLOCK-92 Wave B-7 — useSkillStore 类型定义外迁（原文件，纯搬运零行为变化）。
// 原导入路径 '@/hooks/useSkillStore' 经主文件 re-export 保持兼容。

/** Parameter type supported by Skill manifests. */
export type ParameterType = 'select' | 'number' | 'string' | 'boolean' | 'file';

/** Schema definition for an optional parameter. */
export interface ParameterSchema {
  type: ParameterType;
  description: string;
  options?: string[];
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  accept?: string;
  pattern?: string;
}

/** Output artifact definition. */
export interface OutputArtifact {
  id: string;
  type: string; // relaxed to allow backend to return string literals
  label: string;
  description?: string;
  format?: string;
  columns?: string[];
  dpi?: number;
  requires_plugin?: string;
}

/** Skill source priority (mirrors backend SOURCE_PRIORITY).
 * BLOCK-156 D7 — marketplace 残迹移除（后端无加载代码；远程市场转候选池 C-EXT-2）。 */
export type SkillSource = 'built-in' | 'installed';

/** A single Skill entry. */
export interface Skill {
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  source: SkillSource;
  tags: string[];
  capabilities?: string[];
  parameters: {
    required: string[];
    optional: Record<string, ParameterSchema>;
  };
  plugins: {
    required: string[];
    optional: string[];
  };
  workflows?: {
    default: string | null;
    variants: string[];
  };
  prompts?: {
    system?: string;
    system_file?: string;
    user_templates?: string[];
  };
  recoveryStrategies?: Array<{
    when: string;
    description?: string;
    do: string;
    fallback: string;
    recoverable: boolean;
  }>;
  outputs?: {
    primary: OutputArtifact[];
    secondary: OutputArtifact[];
  };
  metadata?: {
    author?: string;
    license?: string;
    source?: string;
    created?: string;
    updated?: string;
    compatibility?: {
      min_app_version?: string;
      platform?: string[];
    };
  };
}

/** Execution status for a Skill run. */
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed';

/** A single Skill execution record. */
export interface SkillExecution {
  executionId: string;
  skillId: string;
  status: ExecutionStatus;
  startedAt?: Date;
  completedAt?: Date;
  result?: unknown;
  error?: string;
}
