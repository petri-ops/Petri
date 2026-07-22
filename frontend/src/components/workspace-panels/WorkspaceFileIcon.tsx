import React from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
import styles from './WorkspaceFileIcon.module.css';

export type WorkspaceFileKind =
  | 'folder'
  | 'r'
  | 'python'
  | 'notebook'
  | 'typescript'
  | 'javascript'
  | 'data'
  | 'config'
  | 'markdown'
  | 'document'
  | 'pdf'
  | 'image'
  | 'web'
  | 'style'
  | 'shell'
  | 'archive'
  | 'generic';

export interface WorkspaceFilePresentation {
  kind: WorkspaceFileKind;
  label?: string;
  icon?: IconName;
}

const EXTENSION_PRESENTATIONS: Record<string, WorkspaceFilePresentation> = {
  r: { kind: 'r', label: 'R' },
  rmd: { kind: 'r', label: 'R' },
  qmd: { kind: 'r', label: 'R' },
  py: { kind: 'python', label: 'Py' },
  pyw: { kind: 'python', label: 'Py' },
  ipynb: { kind: 'notebook', label: 'NB' },
  ts: { kind: 'typescript', label: 'TS' },
  tsx: { kind: 'typescript', label: 'TS' },
  js: { kind: 'javascript', label: 'JS' },
  jsx: { kind: 'javascript', label: 'JS' },
  mjs: { kind: 'javascript', label: 'JS' },
  cjs: { kind: 'javascript', label: 'JS' },
  csv: { kind: 'data', label: 'CSV' },
  tsv: { kind: 'data', label: 'TSV' },
  xls: { kind: 'data', label: 'XLS' },
  xlsx: { kind: 'data', label: 'XLS' },
  parquet: { kind: 'data', label: 'PQ' },
  feather: { kind: 'data', label: 'FTR' },
  rds: { kind: 'data', label: 'RDS' },
  h5: { kind: 'data', label: 'H5' },
  h5ad: { kind: 'data', label: 'H5' },
  loom: { kind: 'data', label: 'LM' },
  json: { kind: 'config', label: '{}' },
  jsonl: { kind: 'config', label: '{}' },
  yaml: { kind: 'config', label: 'YML' },
  yml: { kind: 'config', label: 'YML' },
  toml: { kind: 'config', label: 'CFG' },
  ini: { kind: 'config', label: 'CFG' },
  lock: { kind: 'config', label: '{}' },
  md: { kind: 'markdown', label: 'M↓' },
  txt: { kind: 'document', label: 'TXT' },
  log: { kind: 'document', label: 'LOG' },
  doc: { kind: 'document', label: 'DOC' },
  docx: { kind: 'document', label: 'DOC' },
  ppt: { kind: 'document', label: 'PPT' },
  pptx: { kind: 'document', label: 'PPT' },
  pdf: { kind: 'pdf', label: 'PDF' },
  png: { kind: 'image', icon: 'image' },
  jpg: { kind: 'image', icon: 'image' },
  jpeg: { kind: 'image', icon: 'image' },
  gif: { kind: 'image', icon: 'image' },
  webp: { kind: 'image', icon: 'image' },
  tif: { kind: 'image', icon: 'image' },
  tiff: { kind: 'image', icon: 'image' },
  bmp: { kind: 'image', icon: 'image' },
  svg: { kind: 'image', icon: 'svg' },
  html: { kind: 'web', label: '#' },
  htm: { kind: 'web', label: '#' },
  css: { kind: 'style', label: 'CSS' },
  scss: { kind: 'style', label: 'CSS' },
  less: { kind: 'style', label: 'CSS' },
  sh: { kind: 'shell', icon: 'terminal' },
  bash: { kind: 'shell', icon: 'terminal' },
  zsh: { kind: 'shell', icon: 'terminal' },
  zip: { kind: 'archive', label: 'ZIP' },
  tar: { kind: 'archive', label: 'TAR' },
  gz: { kind: 'archive', label: 'GZ' },
  tgz: { kind: 'archive', label: 'GZ' },
  bz2: { kind: 'archive', label: 'BZ' },
  xz: { kind: 'archive', label: 'XZ' },
};

export function getWorkspaceFilePresentation(
  name: string,
  type: 'file' | 'dir'
): WorkspaceFilePresentation {
  if (type === 'dir') return { kind: 'folder', icon: 'folder' };
  const normalized = name.trim().toLowerCase();
  const extension = normalized.includes('.') ? normalized.split('.').pop() || '' : '';
  return EXTENSION_PRESENTATIONS[extension] || { kind: 'generic', icon: 'file' };
}

export function WorkspaceFileIcon({
  name,
  type,
}: {
  name: string;
  type: 'file' | 'dir';
}): React.ReactElement {
  const presentation = getWorkspaceFilePresentation(name, type);
  const modeClass = presentation.icon ? styles.glyph : styles.badge;

  return (
    <span
      className={`${styles.fileIcon} ${modeClass}`}
      data-kind={presentation.kind}
      aria-hidden="true"
    >
      {presentation.icon ? (
        <Icon name={presentation.icon} size={15} />
      ) : (
        presentation.label
      )}
    </span>
  );
}
