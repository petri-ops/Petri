import { classifyArtifact, type ResultArtifactRecord, type ResultArtifactKind } from './result-manifest';

export type ResultArtifactFormat = 'png' | 'svg' | 'pdf' | 'other';

export interface ResultArtifactDisplayGroup {
  key: string;
  label: string;
  primary: ResultArtifactRecord;
  variants: ResultArtifactRecord[];
}

function formatOf(artifact: ResultArtifactRecord): ResultArtifactFormat {
  const match = artifact.name.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (match?.[1] === 'png') return 'png';
  if (match?.[1] === 'svg') return 'svg';
  if (match?.[1] === 'pdf') return 'pdf';
  return 'other';
}

function stemOf(artifact: ResultArtifactRecord): string {
  return artifact.name.replace(/\.(png|svg|pdf)$/i, '').toLowerCase();
}

function choosePrimary(artifacts: ResultArtifactRecord[]): ResultArtifactRecord {
  return [...artifacts].sort((a, b) => {
    const rank = (item: ResultArtifactRecord) => ({ png: 0, svg: 1, pdf: 2, other: 3 }[formatOf(item)]);
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  })[0];
}

function artifactLabel(artifact: ResultArtifactRecord): string {
  return artifact.label || artifact.title || artifact.name.replace(/\.[^.]+$/, '');
}

export function artifactFormatLabel(artifact: ResultArtifactRecord): string {
  const format = formatOf(artifact);
  return format === 'other' ? '文件' : format.toUpperCase();
}

export function groupResultArtifacts(artifacts: ResultArtifactRecord[]): ResultArtifactDisplayGroup[] {
  const groups = new Map<string, ResultArtifactRecord[]>();
  const plotStems = new Set(
    artifacts
      .filter((artifact) => classifyArtifact(artifact) === 'plot' && formatOf(artifact) !== 'other')
      .map(stemOf),
  );
  for (const artifact of artifacts) {
    const kind = classifyArtifact(artifact);
    const format = formatOf(artifact);
    const isDisplayVariant = format !== 'other' && (kind === 'plot' || (format === 'pdf' && plotStems.has(stemOf(artifact))));
    const key = isDisplayVariant ? stemOf(artifact) : `artifact:${artifact.name}`;
    groups.set(key, [...(groups.get(key) || []), artifact]);
  }
  return [...groups.entries()].map(([key, members]) => {
    const primary = choosePrimary(members);
    return {
      key,
      label: artifactLabel(primary),
      primary,
      variants: [...members].sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}

export function isRelatedArtifactKind(kind: ResultArtifactKind | 'mixed'): boolean {
  return kind === 'data' || kind === 'file';
}
