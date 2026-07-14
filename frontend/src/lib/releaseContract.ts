// Release contract loader — 单一来源 release-contract.json 的轻量读取
//
// 桌面版前端需要展示「发行版渠道 / 版本号 / 一句话定位」等元信息。
// 源数据放在仓库根 release-contract.json，避免在多文件里散写。
//
// 注意：
// - 不做 schema 校验；让 test/release-contract.test.mjs 在构建前发现漂移。
// - JSON 是编译期静态导入（Vite 原生支持），运行期零开销。
// - 故意只暴露窄接口，避免把整个 contract 漏到组件里。

import contract from '../../../release-contract.json';

export interface ReleasePlatform {
  id: string;
  supported: boolean;
  minOs?: string;
  codeSigned?: boolean;
  notarized?: boolean;
  runtimeArtifact?: {
    format: string;
    sizeBytes: number | null;
    sha256: string | null;
    url: string | null;
  };
  reason?: string;
}

export interface ReleaseGoldenPath {
  name: string;
  dataset: string;
  tool: string;
  reportFormat: 'html' | 'pdf';
}

export interface ReleaseContract {
  channel: string;
  version: string;
  tagline: string;
  goldenPath: ReleaseGoldenPath;
  platforms: ReleasePlatform[];
  gaCriteria: string[];
  knownLimits: string[];
}

const cached = contract as unknown as ReleaseContract;

/**
 * Returns the full release contract. Cheap; safe to call many times.
 * The JSON file is bundled at build time by Vite.
 */
export function loadReleaseContract(): ReleaseContract {
  return cached;
}

/** One-line positioning used by onboarding / marketing surfaces. */
export function loadReleaseTagline(): string {
  return cached.tagline;
}

/** Human-readable version + channel, e.g. "v0.1.0-beta (beta)". */
export function loadReleaseVersionLabel(): string {
  return `${cached.version} (${cached.channel})`;
}