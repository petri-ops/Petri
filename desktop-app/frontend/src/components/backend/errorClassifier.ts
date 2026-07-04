// M2-2 错误归因（V2）
// 把 R 脚本/后端的裸 stderr 映射成人话原因 + 分类 + 是否可重试。
// 接入各工具错误 toast，显示 humanReason 而非原始 stderr。

export type ErrorCategory = 'data' | 'package' | 'memory' | 'backend' | 'unknown';

export interface ClassifiedError {
  category: ErrorCategory;
  humanReason: string;
  retryable: boolean;
}

interface Rule {
  pattern: RegExp;
  category: ErrorCategory;
  humanReason: string;
  retryable: boolean;
}

// 按 stderr 关键词映射，顺序敏感（前匹配优先）
const RULES: Rule[] = [
  // 包缺失——最常见的分析失败原因
  {
    pattern:
      /could not find package|there is no package called|package .* is not available|there is no package named/i,
    category: 'package',
    humanReason: '缺少 R 包依赖，请通过插件商店安装对应卡片插件，或在 R 中 install.packages',
    retryable: false,
  },
  // 内存不足
  {
    pattern:
      /cannot allocate vector|reached total allocation|memory\.size|out of memory|Cannot allocate memory/i,
    category: 'memory',
    humanReason: '内存不足，请减小数据量（降采样/过滤低表达基因）或关闭其他程序',
    retryable: false,
  },
  // 后端不通——可重试（r-server 可能重启中）
  {
    pattern: /ECONNREFUSED|fetch failed|connect ECONNREFUSED|socket hang up|ETIMEDOUT|ECONNRESET/i,
    category: 'backend',
    humanReason: '后端服务未响应，正在重试或请稍后再试',
    retryable: true,
  },
  // 数据格式问题
  {
    pattern:
      /unexpected symbol|invalid input|unknown input format|could not find function read|failed to parse|malformed/i,
    category: 'data',
    humanReason: '数据格式不符，请检查输入文件（列名/格式/编码）',
    retryable: false,
  },
  // 文件不存在
  {
    pattern: /cannot open file|No such file or directory|file does not exist/i,
    category: 'data',
    humanReason: '文件不存在或路径错误，请重新上传',
    retryable: false,
  },
];

const UNKNOWN: ClassifiedError = {
  category: 'unknown',
  humanReason: '分析过程出错，请查看诊断日志或重试',
  retryable: false,
};

/**
 * 把错误（stderr 字符串 / Error 对象 / unknown）归类成人话。
 */
export function classifyError(err: unknown): ClassifiedError {
  const msg = toMessage(err);
  if (!msg) return UNKNOWN;

  for (const rule of RULES) {
    if (rule.pattern.test(msg)) {
      return { category: rule.category, humanReason: rule.humanReason, retryable: rule.retryable };
    }
  }
  return UNKNOWN;
}

function toMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return err ? String(err) : '';
}
