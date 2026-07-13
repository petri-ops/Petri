#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_TARGET_ROOT = path.resolve(process.cwd(), 'templates', 'harness-tools');
const DEFAULT_SUPPORTED_PLATFORMS = ['macos-arm64', 'macos-x64', 'linux-x64', 'windows-x64'];

function titleFromId(id) {
  const text = String(id || '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return text ? text.replace(/\b\w/g, (ch) => ch.toUpperCase()) : 'New Tool';
}

function parseArgs(argv) {
  const args = {
    id: '',
    title: '',
    subtitle: 'Harness tool starter',
    category: 'analysis',
    description: '',
    language: 'r',
    targetRoot: DEFAULT_TARGET_ROOT,
    force: false,
    dryRun: false,
  };

  const rest = [...argv];
  if (rest.length && !rest[0].startsWith('--')) {
    args.id = rest.shift();
  }

  while (rest.length) {
    const token = rest.shift();
    if (token === '--title') args.title = String(rest.shift() || '');
    else if (token === '--subtitle') args.subtitle = String(rest.shift() || '');
    else if (token === '--category') args.category = String(rest.shift() || 'analysis');
    else if (token === '--description') args.description = String(rest.shift() || '');
    else if (token === '--language') args.language = String(rest.shift() || 'r').toLowerCase();
    else if (token === '--output' || token === '--target') args.targetRoot = path.resolve(String(rest.shift() || DEFAULT_TARGET_ROOT));
    else if (token === '--force') args.force = true;
    else if (token === '--dry-run') args.dryRun = true;
    else if (token === '--help' || token === '-h') {
      args.help = true;
      return args;
    } else if (token && token.startsWith('--')) {
      throw new Error(`Unknown option: ${token}`);
    } else if (!args.id) {
      args.id = String(token || '');
    }
  }

  return args;
}

function defaultRuntime(language) {
  if (language === 'python') {
    return {
      python: '>=3.10.0',
    };
  }
  return {
    r: '>=4.3.0',
  };
}

function defaultPackages(language) {
  if (language === 'python') {
    return {
      python: {},
    };
  }
  return {
    r: {},
  };
}

function defaultBuiltAgainst(language) {
  return language === 'python' ? { python: '3.11' } : { r: '4.5' };
}

function defaultFailureModes() {
  return [
    {
      code: 'missing_required_file_inputs',
      title: '缺少必需输入文件',
      description: '工具至少需要一个输入文件，缺失时无法继续。',
      recoverable: true,
      suggestedFix: '让 Harness 自动补齐文件输入，或由用户手动选择正确的数据文件。',
      detect: 'missing required file inputs|missing input file|please provide file',
    },
    {
      code: 'input_path_not_found',
      title: '输入路径不存在',
      description: '用户提供的文件路径不存在或无法访问。',
      recoverable: true,
      suggestedFix: '重新索引项目文件，或让用户确认路径是否拼写正确。',
      detect: 'path not found|no such file|input path not found',
    },
    {
      code: 'missing_required_columns',
      title: '缺少必需列',
      description: '输入表缺少工具运行所需的关键列，或列名不符合约定。',
      recoverable: true,
      suggestedFix: '让 Harness 探测表头并尝试映射常见列别名，例如 gene、log2FC、pvalue。',
      detect: 'missing required columns|table header|column not found',
    },
    {
      code: 'invalid_numeric_values',
      title: '数值列不可解析',
      description: '输入数据包含非数字、空值或无限值，导致后续统计计算失败。',
      recoverable: true,
      suggestedFix: '过滤无效行后再运行，或提示用户更换更干净的数据表。',
      detect: 'invalid numeric values|non-numeric|nan|inf',
    },
    {
      code: 'runtime_not_ready',
      title: '运行时不可用',
      description: 'R 或 Python 运行时没有就绪，无法执行该工具。',
      recoverable: true,
      suggestedFix: '先安装或配置对应运行时，再重试执行工具。',
      detect: 'runtime not ready|runtime unavailable|not configured',
    },
    {
      code: 'parameter_out_of_range',
      title: '参数超出范围',
      description: '数值参数过大、过小或超出工具允许的取值范围。',
      recoverable: true,
      suggestedFix: '让 Harness 自动裁剪参数到合理范围，并在卡片里提示修正。',
      detect: 'out of range|too large|too small|clamp',
    },
    {
      code: 'empty_result_or_insufficient_signal',
      title: '结果信号不足',
      description: '数据可能太弱、阈值太严或结果本身为空，导致输出接近空白。',
      recoverable: true,
      suggestedFix: '适度放宽阈值，或者提示用户检查数据是否真的存在足够信号。',
      detect: 'empty result|no significant|insufficient signal|no rows meet threshold',
    },
    {
      code: 'required_artifact_missing',
      title: '必需结果产物缺失',
      description: '工具结束后没有生成 output schema 声明的必需文件。',
      recoverable: true,
      suggestedFix: '检查运行日志和输出路径，修复后重新执行。',
      detect: 'required artifact missing|was not produced',
    },
    {
      code: 'required_artifact_empty',
      title: '必需结果产物为空',
      description: '必需结果文件为空或不可读取。',
      recoverable: true,
      suggestedFix: '检查写文件逻辑、磁盘空间和运行日志后重新执行。',
      detect: 'required artifact empty|empty or unreadable',
    },
    {
      code: 'artifact_type_mismatch',
      title: '结果产物类型不匹配',
      description: '声明的结果类型与真实文件格式不一致。',
      recoverable: true,
      suggestedFix: '修正 output schema 或输出正确格式的文件。',
      detect: 'artifact type mismatch|declared as|detected as',
    },
  ];
}

function defaultInputs() {
  return [
    {
      id: 'input_table',
      label: '输入表（CSV/TSV）',
      type: 'file',
      required: true,
      accept: '.csv,.tsv,.tab',
      hint: '替换成该工具真正需要的首要输入文件。',
    },
  ];
}

function defaultOutputs() {
  return [
    {
      id: 'report_html',
      type: 'html',
      label: 'HTML 报告',
    },
  ];
}

export function buildHarnessToolScaffold(options = {}) {
  const id = String(options.id || '').trim();
  if (!id) throw new Error('id is required');
  const language = String(options.language || 'r').toLowerCase();
  if (!['r', 'python'].includes(language)) {
    throw new Error(`language must be r or python, got ${language}`);
  }

  const title = String(options.title || titleFromId(id)).trim();
  const subtitle = String(options.subtitle || 'Harness tool starter').trim();
  const category = String(options.category || 'analysis').trim();
  const description = String(options.description || `Starter scaffold for ${title}`).trim();
  const targetRoot = path.resolve(String(options.targetRoot || DEFAULT_TARGET_ROOT));
  const toolDir = path.join(targetRoot, id);
  const scriptName = language === 'python' ? `${id}.py` : `${id}.R`;
  const scriptPath = path.join(toolDir, 'scripts', scriptName);

  const pluginJson = {
    id,
    pluginManifestVersion: 1,
    title,
    version: '0.1.0',
    language,
    description,
    packages: defaultPackages(language),
    runtime: defaultRuntime(language),
    builtAgainst: defaultBuiltAgainst(language),
    platform: DEFAULT_SUPPORTED_PLATFORMS,
    supportedPlatforms: DEFAULT_SUPPORTED_PLATFORMS,
  };

  const toolDefinition = {
    id,
    title,
    subtitle,
    category,
    language,
    description,
    inputs: defaultInputs(),
    outputs: defaultOutputs(),
    failureModes: defaultFailureModes(),
    estimatedMinutes: 5,
  };

  const scriptStub =
    language === 'python'
      ? `#!/usr/bin/env python3
from pathlib import Path


def main():
    print("[${id}] TODO: implement analysis logic")


if __name__ == "__main__":
    main()
`
      : `#!/usr/bin/env Rscript
cat("[${id}] TODO: implement analysis logic\\n")
`;

  return {
    id,
    language,
    title,
    subtitle,
    category,
    description,
    targetRoot,
    toolDir,
    files: [
      { path: path.join(toolDir, 'plugin.json'), content: JSON.stringify(pluginJson, null, 2) + '\n' },
      { path: path.join(toolDir, 'tool-definition.json'), content: JSON.stringify(toolDefinition, null, 2) + '\n' },
      { path: scriptPath, content: scriptStub },
      {
        path: path.join(toolDir, 'fixtures', 'input.csv'),
        content: 'feature,value\nexample,1\n',
      },
      {
        path: path.join(toolDir, 'fixtures', 'fixture.json'),
        content: JSON.stringify({
          fixtureVersion: 1,
          id: `${id}-contract`,
          toolId: id,
          params: { input_table: 'input.csv' },
          expectedReadiness: 'ready',
          expectedArtifacts: [{ id: 'report_html', type: 'html', required: true }],
        }, null, 2) + '\n',
      },
      {
        path: path.join(toolDir, 'README.md'),
        content:
          `# ${title}\n\nThis is a Harness tool scaffold.\n\n- Language: ${language}\n- Category: ${category}\n- Edit plugin.json and tool-definition.json before shipping.\n`,
      },
    ],
  };
}

export function writeHarnessToolScaffold(options = {}) {
  const scaffold = buildHarnessToolScaffold(options);
  const exists = fs.existsSync(scaffold.toolDir);
  if (exists && !options.force) {
    const entries = fs.readdirSync(scaffold.toolDir);
    if (entries.length > 0) {
      throw new Error(`target directory already exists and is not empty: ${scaffold.toolDir}`);
    }
  }

  if (!options.dryRun) {
    for (const file of scaffold.files) {
      fs.mkdirSync(path.dirname(file.path), { recursive: true });
      fs.writeFileSync(file.path, file.content);
    }
  }

  return scaffold;
}

function printHelp() {
  console.log(`Usage:
  node scripts/scaffold-harness-tool.mjs <id> --title "Tool Title" [options]

Options:
  --subtitle <text>        Short subtitle
  --category <text>        Tool category (default: analysis)
  --description <text>     Long description
  --language <r|python>    Tool runtime (default: r)
  --output <dir>           Scaffold root directory (default: templates/harness-tools)
  --target <dir>           Alias for --output
  --force                  Overwrite files if the target exists
  --dry-run                Print the target without writing files
  -h, --help               Show help
`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
      process.exit(0);
    }
    if (!args.id) {
      printHelp();
      process.exit(1);
    }
    if (!args.title) {
      args.title = titleFromId(args.id);
    }
    const scaffold = writeHarnessToolScaffold(args);
    console.log(`[harness-scaffold] ${scaffold.toolDir}`);
    for (const file of scaffold.files) {
      console.log(`- ${path.relative(scaffold.toolDir, file.path)}`);
    }
  } catch (error) {
    console.error(`[harness-scaffold] ${error.message}`);
    process.exit(1);
  }
}
