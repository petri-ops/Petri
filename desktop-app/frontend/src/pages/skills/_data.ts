// ============================================================
// /skills 页数据加载层
//
// 数据源:`static/skills-data/bioskills.json`(由 scripts/sync-bioskills.mjs 生成)
// 上游:GPTomics/bioSkills (MIT License)
//
// ⚠️ MIT 合规约束(详见 .kiro/steering/skills-page-dev.md):
//   - 不修改 SKILL.md 原文
//   - attribution 4 处强制
//   - zip 内必含 LICENSE + README.txt
// ============================================================

export interface SkillSource {
  id: string;
  name: string;
  url: string;
  license: string;
  license_url: string;
  commit: string;
  commit_time: string;
  fetched_at: string;
  skill_count: number;
}

export interface SkillCategory {
  id: string;
  name_en: string;
  name_zh?: string;
  skill_count: number;
}

export interface SkillCoverage {
  covered_by: string[]; // ['tool:cellchat', 'docs:/docs/single-cell/module07']
  match_quality: 'high' | 'medium' | 'low' | 'none';
  notes?: string | null;
}

export interface SkillZhNote {
  title_zh: string | null;
  summary_zh: string;
  biof3_tip: string | null;
}

export interface Skill {
  source_id: string;
  id: string; // {category}/{skill_dir}
  category: string;
  skill_dir: string;
  title: string;
  fm_name: string;
  description: string;
  use_when: string | null;
  primary_tool: string | null;
  tool_type: string | null;
  line_count: number;
  h2_count: number;
  skill_md_path: string;
  github_url: string;
  zip_path: string; // /skills-data/zips/{cat}/{skill}.zip
  md_path: string; // /skills-data/md/{cat}/{skill}.md  (S2 新增)
  biof3_coverage?: SkillCoverage;
  biof3_zh?: SkillZhNote;
}

export interface BioF3Meta {
  coverage_count: number;
  coverage_percent: number;
  zh_notes_count: number;
}

export interface SkillsData {
  schema_version: number;
  sources: SkillSource[];
  biof3_meta: BioF3Meta;
  categories: SkillCategory[];
  skills: Skill[];
}

import bioskillsRaw from '@/static/skills-data/bioskills.json';
export const skillsData = bioskillsRaw as SkillsData;

// ---- 辅助:解析 covered_by 字符串到链接 ----
export interface CoverageLink {
  type: 'tool' | 'docs' | 'figcode' | 'single-cell' | 'blog';
  raw: string; // 原始 prefix:value
  label: string; // 显示用
  href: string | null;
}

export function parseCoverageLink(raw: string): CoverageLink {
  const colonIdx = raw.indexOf(':');
  if (colonIdx < 0) return { type: 'docs', raw, label: raw, href: null };
  const prefix = raw.slice(0, colonIdx);
  const value = raw.slice(colonIdx + 1);
  switch (prefix) {
    case 'tool':
      return { type: 'tool', raw, label: `工具:${value}`, href: `/tools/#${value}` };
    case 'docs':
      return { type: 'docs', raw, label: `教程:${value}`, href: value };
    case 'figcode':
      return { type: 'figcode', raw, label: `figcode:${value}`, href: `/figcode#${value}` };
    case 'single-cell':
      return { type: 'single-cell', raw, label: `单细胞:${value}`, href: `/single-cell#${value}` };
    case 'blog':
      return { type: 'blog', raw, label: `博客:${value}`, href: `/blog/${value}` };
    default:
      return { type: 'docs', raw, label: raw, href: null };
  }
}
