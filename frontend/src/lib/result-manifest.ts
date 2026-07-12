export type ResultArtifactKind = 'report' | 'plot' | 'table' | 'text' | 'data' | 'file';

export interface ResultArtifactRecord {
  name: string;
  type?: string;
  label?: string;
  title?: string;
  description?: string;
  section?: string;
  role?: string;
  url?: string;
  preview?: boolean;
  download?: boolean;
}

export interface ResultSectionRecord {
  id: string;
  label: string;
  artifactNames: string[];
  description?: string;
}

export interface NormalizedResultManifest {
  raw: unknown;
  title: string | null;
  summary: Record<string, unknown> | null;
  artifacts: ResultArtifactRecord[];
  sections: ResultSectionRecord[];
  hasExplicitSections: boolean;
}

const SECTION_ORDER: ResultArtifactKind[] = ['report', 'plot', 'table', 'text', 'data', 'file'];

const SECTION_LABELS: Record<ResultArtifactKind, string> = {
  report: '报告',
  plot: '图表',
  table: '表格',
  text: '文本',
  data: '数据',
  file: '其他',
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeArtifact(item: unknown): ResultArtifactRecord | null {
  const obj = asRecord(item);
  if (!obj) return null;
  const name = asString(obj.name || obj.filename || obj.path);
  if (!name) return null;
  return {
    name,
    type: asString(obj.type) || undefined,
    label: asString(obj.label) || undefined,
    title: asString(obj.title) || undefined,
    description: asString(obj.description) || undefined,
    section: asString(obj.section) || undefined,
    role: asString(obj.role) || undefined,
    url: asString(obj.url) || undefined,
    preview: typeof obj.preview === 'boolean' ? obj.preview : undefined,
    download: typeof obj.download === 'boolean' ? obj.download : undefined,
  };
}

export function getArtifactName(item: ResultArtifactRecord | { name?: string; filename?: string; path?: string }): string {
  return asString((item as ResultArtifactRecord).name || (item as { filename?: string }).filename || (item as { path?: string }).path);
}

export function classifyArtifact(artifact: ResultArtifactRecord): ResultArtifactKind {
  const name = getArtifactName(artifact).toLowerCase();
  const type = asString(artifact.type).toLowerCase();
  if (type === 'report' || /(^|\/)report(\.html?)?$/.test(name) || /\.html?$/i.test(name)) return 'report';
  if (type === 'plot' || /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(name)) return 'plot';
  if (type === 'table' || /\.(csv|tsv|xls|xlsx)$/i.test(name)) return 'table';
  if (type === 'text' || /\.(txt|md|json|log)$/i.test(name)) return 'text';
  if (/\.(rds|rda|rdata|h5ad|loom|h5|mtx|npz|zarr|feather|parquet)$/i.test(name)) return 'data';
  return 'file';
}

function artifactSortWeight(kind: ResultArtifactKind): number {
  return SECTION_ORDER.indexOf(kind);
}

function buildDerivedSections(artifacts: ResultArtifactRecord[]): ResultSectionRecord[] {
  const bucket = new Map<ResultArtifactKind, ResultArtifactRecord[]>();
  for (const kind of SECTION_ORDER) bucket.set(kind, []);
  for (const artifact of artifacts) {
    const kind = classifyArtifact(artifact);
    bucket.get(kind)?.push(artifact);
  }

  return SECTION_ORDER.filter((kind) => (bucket.get(kind)?.length || 0) > 0).map((kind) => ({
    id: kind,
    label: SECTION_LABELS[kind],
    artifactNames: (bucket.get(kind) || []).map((artifact) => artifact.name),
  }));
}

function normalizeExplicitSections(rawSections: unknown): ResultSectionRecord[] {
  if (!Array.isArray(rawSections)) return [];
  return rawSections
    .map((item, index) => {
      const obj = asRecord(item);
      if (!obj) return null;
      const id = asString(obj.id) || `section-${index + 1}`;
      const label = asString(obj.label || obj.title) || id;
      const artifactNames = Array.isArray(obj.artifactNames)
        ? obj.artifactNames.map((name) => asString(name)).filter(Boolean)
        : Array.isArray(obj.artifacts)
          ? obj.artifacts
              .map((entry) => getArtifactName(normalizeArtifact(entry) || { name: '' }))
              .filter(Boolean)
          : [];
      return {
        id,
        label,
        description: asString(obj.description) || undefined,
        artifactNames,
      } as ResultSectionRecord;
    })
    .filter(Boolean) as ResultSectionRecord[];
}

function collectArtifacts(raw: Record<string, unknown>, fallbackFiles: ResultArtifactRecord[]): ResultArtifactRecord[] {
  const source = Array.isArray(raw.files)
    ? raw.files
    : Array.isArray(raw.outputs)
      ? raw.outputs
      : [];
  const normalized = source.map(normalizeArtifact).filter(Boolean) as ResultArtifactRecord[];
  const merged = [...normalized];
  for (const file of fallbackFiles) {
    if (!merged.some((item) => item.name === file.name)) merged.push(file);
  }
  return merged;
}

export function normalizeResultManifest(
  raw: unknown,
  fallbackFiles: ResultArtifactRecord[] = [],
): NormalizedResultManifest | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const title = asString(obj.title || obj.name || obj.reportTitle) || null;
  const summary = asRecord(obj.summary);
  const artifacts = collectArtifacts(obj, fallbackFiles);
  const explicitSections = normalizeExplicitSections(obj.sections);
  const sections = explicitSections.length > 0 ? explicitSections : buildDerivedSections(artifacts);
  return {
    raw,
    title,
    summary,
    artifacts,
    sections,
    hasExplicitSections: explicitSections.length > 0,
  };
}

export function findArtifactByName(
  artifacts: ResultArtifactRecord[],
  name: string,
): ResultArtifactRecord | null {
  const target = asString(name);
  if (!target) return null;
  return artifacts.find((artifact) => artifact.name === target) || null;
}

export function pickPreferredArtifact(
  artifacts: ResultArtifactRecord[],
  preferredName: string | null | undefined,
): ResultArtifactRecord | null {
  const preferred = preferredName ? findArtifactByName(artifacts, preferredName) : null;
  if (preferred) return preferred;
  const ordered = [...artifacts].sort((a, b) => artifactSortWeight(classifyArtifact(a)) - artifactSortWeight(classifyArtifact(b)));
  return ordered[0] || null;
}

export function isTextLikeArtifact(artifact: ResultArtifactRecord): boolean {
  return classifyArtifact(artifact) === 'text';
}

export function isHtmlArtifact(artifact: ResultArtifactRecord): boolean {
  return classifyArtifact(artifact) === 'report';
}

export function isImageArtifact(artifact: ResultArtifactRecord): boolean {
  return classifyArtifact(artifact) === 'plot';
}

export function artifactKindLabel(kind: ResultArtifactKind): string {
  return SECTION_LABELS[kind];
}
