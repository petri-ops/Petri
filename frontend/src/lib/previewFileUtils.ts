// Shared file-preview helpers used by both the workspace file tree and
// ResultView. Extracted from ProjectWorkspace during UI-146 (T85 增量4) to break
// the CenterPanel -> project-workspace cycle without duplicating logic.
import { getApiPrefix } from '@/lib/authClient';

export function fileExtension(name?: string): string {
  const idx = name?.lastIndexOf('.') ?? -1;
  return idx >= 0 && name ? name.slice(idx + 1).toLowerCase() : '';
}

export function isImageFile(name?: string): boolean {
  return ['png', 'apng', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico', 'tif', 'tiff', 'heic', 'heif'].includes(fileExtension(name));
}

export function isTextFile(name?: string): boolean {
  return [
    'txt', 'md', 'markdown', 'csv', 'tsv', 'tab', 'json', 'jsonl', 'log',
    'r', 'py', 'sh', 'bash', 'zsh',
    'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx',
    'css', 'scss', 'html', 'htm', 'xml',
    'yaml', 'yml', 'toml', 'ini', 'conf', 'sql',
    'sam', 'bed', 'gtf', 'gff', 'vcf', 'fasta', 'fa', 'fastq', 'fq',
  ].includes(fileExtension(name));
}

export function isMarkdownFile(name?: string): boolean {
  return ['md', 'markdown'].includes(fileExtension(name));
}

export function workspaceFileUrlFor(projectId: string, relativePath: string): string {
  return `${getApiPrefix()}/workspaces/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(relativePath)}`;
}

export function formatPreviewText(name: string, text: string): string {
  if (fileExtension(name) === 'json') {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  return text;
}
