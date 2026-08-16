// ============================================================
// Tools — 在线分析工具元数据
//
// 每个工具定义：输入参数、输出类型、关联教程、demo 数据。
// 前端根据 inputs 自动生成参数表单，后端根据 id 路由到对应脚本。
// ============================================================

export interface InputField {
  id: string;
  label: string;
  type: 'file' | 'select' | 'number' | 'text' | 'checkbox';
  required?: boolean;
  accept?: string; // file type filter
  options?: { value: string; label: string }[]; // for select
  default?: string | number | boolean;
  hint?: string;
  placeholder?: string;
}

export interface OutputDef {
  id: string;
  type: 'table' | 'plot' | 'file' | 'text';
  label: string;
}

export interface Tool {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  language: 'r' | 'python';
  description: string;
  longDescription: string;
  inputs: InputField[];
  outputs: OutputDef[];
  tutorialUrl: string;
  demoDataUrl?: string; // 内置 demo 数据（点击"使用示例数据"自动填充）
  estimatedMinutes: number;
  packages: string[];
  /** Theme color (hex) for tool icon / nav dot. Was scattered in TOOL_COLORS. */
  color: string;
  /** Static demo report URL (HTML). Was scattered in REPORT_URLS. */
  reportUrl?: string;
  /** True = tool not yet runnable, only shows as placeholder card.
   * Wave 1 of machine-learning column adds 7 placeholders; will flip to false as Wave 2-4 ship. */
  comingSoon?: boolean;
  _manifest?: {
    execution?: {
      scriptFingerprint?: string | null;
      installedFingerprint?: string | null;
      currentFingerprint?: string | null;
      manifestDrift?: boolean;
      driftReason?: string | null;
    };
  };
}
