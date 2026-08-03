import {
  classifyArtifact,
  type ResultArtifactNavSection,
  type ResultArtifactRecord,
  type ResultArtifactKind,
} from './result-manifest';

export type ResultArtifactFormat = 'png' | 'svg' | 'pdf' | 'other';

export interface ResultArtifactDisplayGroup {
  key: string;
  label: string;
  primary: ResultArtifactRecord;
  variants: ResultArtifactRecord[];
}

export interface ResultArtifactPickerGroup {
  id: string;
  label: string;
  options: ResultArtifactDisplayGroup[];
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

export function buildResultArtifactPickerGroups(
  sections: ResultArtifactNavSection[],
  options: { includeRelated?: boolean; allArtifacts?: ResultArtifactRecord[] } = {},
): ResultArtifactPickerGroup[] {
  const uniqueArtifacts = [...new Map(
    (options.allArtifacts || sections.flatMap((section) => section.artifacts))
      .map((artifact) => [artifact.name, artifact]),
  ).values()];
  const displayGroups = groupResultArtifacts(uniqueArtifacts);
  const seenGroupKeys = new Set<string>();
  return sections.flatMap((section) => {
    const sectionNames = new Set(section.artifactNames);
    const pickerOptions = displayGroups.filter((group) => {
      if (seenGroupKeys.has(group.key)) return false;
      if (!group.variants.some((artifact) => sectionNames.has(artifact.name))) return false;
      if (!options.includeRelated && isRelatedArtifactKind(classifyArtifact(group.primary))) return false;
      seenGroupKeys.add(group.key);
      return true;
    });
    return pickerOptions.length > 0
      ? [{ id: section.id, label: section.label, options: pickerOptions }]
      : [];
  });
}

export function filterResultArtifactRelatedSections(
  sections: ResultArtifactNavSection[],
  pickerGroups: ResultArtifactPickerGroup[],
): ResultArtifactNavSection[] {
  const primaryVariantNames = new Set(
    pickerGroups.flatMap((group) =>
      group.options.flatMap((option) => option.variants.map((artifact) => artifact.name)),
    ),
  );
  return sections.flatMap((section) => {
    const artifacts = section.artifacts.filter(
      (artifact) => !primaryVariantNames.has(artifact.name),
    );
    if (artifacts.length === 0) return [];
    return [{
      ...section,
      artifactNames: artifacts.map((artifact) => artifact.name),
      artifacts,
    }];
  });
}

export function findResultArtifactPickerOption(
  groups: ResultArtifactPickerGroup[],
  artifactName: string,
): { sectionId: string; option: ResultArtifactDisplayGroup } | null {
  for (const group of groups) {
    const option = group.options.find((item) =>
      item.variants.some((artifact) => artifact.name === artifactName),
    );
    if (option) return { sectionId: group.id, option };
  }
  return null;
}

export function isRelatedArtifactKind(kind: ResultArtifactKind | 'mixed'): boolean {
  return kind === 'data' || kind === 'file';
}
